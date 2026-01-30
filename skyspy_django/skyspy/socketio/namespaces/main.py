"""
Main Socket.IO namespace for SkySpy.

Handles all main data streams including aircraft, safety, stats, alerts, acars, etc.
This is the default namespace ('/') that clients connect to.
"""
import logging
import statistics as stats_lib
from datetime import datetime, timedelta
from typing import Optional

import socketio
from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.cache import cache
from django.db.models import Avg, Case, CharField, Count, F, Max, Min, Q, Value, When
from django.db.models.functions import ExtractHour, Floor, TruncHour
from django.utils import timezone

from skyspy.socketio.middleware.auth import authenticate_socket
from skyspy.socketio.middleware.permissions import (
    TOPIC_PERMISSIONS,
    check_request_permission,
    check_topic_permission,
)
from skyspy.socketio.server import sio
from skyspy.socketio.utils.batcher import MessageBatcher
from skyspy.socketio.utils.rate_limiter import RateLimiter

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


class MainNamespace(socketio.AsyncNamespace):
    """
    Main Socket.IO namespace for SkySpy.

    Handles:
    - Connection/disconnection with authentication
    - Topic subscriptions (aircraft, safety, stats, alerts, acars, airspace, notams)
    - Request/response pattern for data queries
    - Room-based message broadcasting from Celery tasks

    Supported Topics:
    - aircraft: Real-time aircraft position updates
    - safety: Safety alerts and events
    - stats: Statistics updates
    - alerts: Custom alert notifications
    - acars: ACARS message updates
    - airspace: Airspace boundary updates
    - notams: NOTAM updates

    All data from Celery broadcasts is automatically routed to subscribers
    via Socket.IO rooms (topic_aircraft, topic_safety, etc.).
    """

    # Supported subscription topics
    SUPPORTED_TOPICS = ['aircraft', 'safety', 'stats', 'alerts', 'acars', 'airspace', 'notams']

    # Request types that require specific permissions
    REQUEST_PERMISSIONS = {
        'aircraft-info': 'aircraft.view',
        'aircraft-info-bulk': 'aircraft.view',
        'safety-events': 'safety.view',
        'safety-stats': 'safety.view',
        'acars-stats': 'acars.view',
        'system-info': 'system.view_info',
        'system-databases': 'system.view_databases',
        'system-status': 'system.view_status',
    }

    def __init__(self, namespace: str = '/'):
        super().__init__(namespace)
        # Per-session state is stored via sio.save_session/get_session

    async def on_connect(self, sid: str, environ: dict, auth: Optional[dict] = None):
        """
        Handle client connection.

        Authenticates the connection, stores user in session, joins default rooms,
        and sends initial snapshot.

        Args:
            sid: Session ID
            environ: ASGI environ dict
            auth: Optional authentication dict from client

        Returns:
            True to accept connection, False to reject
        """
        logger.info(f"Socket.IO connection attempt: {sid}")

        # Authenticate
        user, error = await authenticate_socket(auth)

        if error:
            auth_mode = getattr(settings, 'AUTH_MODE', 'hybrid')
            reject_invalid = getattr(settings, 'WS_REJECT_INVALID_TOKENS', False)
            if auth_mode == 'private' or (auth_mode == 'hybrid' and reject_invalid):
                logger.warning(f"Socket.IO connection rejected for {sid}: {error}")
                return False

        # Store user in session
        await sio.save_session(sid, {
            'user': user,
            'subscribed_topics': set(),
            'client_filters': {},
            'rate_limiter': RateLimiter(),
            'connected_at': datetime.utcnow().isoformat(),
        })

        logger.info(
            f"Socket.IO connected: {sid}, "
            f"user={user.username if user.is_authenticated else 'anonymous'}"
        )

        # Join default rooms based on permissions
        await self._join_default_rooms(sid, user)

        # Send initial aircraft snapshot
        await self._send_initial_state(sid)

        return True

    async def on_disconnect(self, sid: str):
        """
        Handle client disconnection.

        Cleans up session state and leaves all rooms.

        Args:
            sid: Session ID
        """
        try:
            session = await sio.get_session(sid)
            subscribed = session.get('subscribed_topics', set())

            # Leave all subscribed rooms
            for topic in subscribed:
                room = f"topic_{topic}"
                await sio.leave_room(sid, room)

            logger.info(f"Socket.IO disconnected: {sid}")
        except Exception as e:
            logger.debug(f"Error during disconnect cleanup for {sid}: {e}")

    async def on_subscribe(self, sid: str, data: dict):
        """
        Handle topic subscription request.

        Joins rooms for requested topics after checking permissions.

        Args:
            sid: Session ID
            data: Dict with 'topics' list, e.g. {'topics': ['aircraft', 'safety']}

        Emits:
            'subscribed' with list of successfully subscribed topics
        """
        topics = data.get('topics', [])
        if isinstance(topics, str):
            topics = [topics]

        # Handle 'all' topic - expand to all supported topics
        logger.info(f"[on_subscribe] {sid} requested topics: {topics}")
        if 'all' in topics:
            topics = list(self.SUPPORTED_TOPICS)
            logger.info(f"[on_subscribe] Expanded 'all' to: {topics}")

        session = await sio.get_session(sid)
        user = session.get('user')
        subscribed = session.get('subscribed_topics', set())

        joined = []
        denied = []

        for topic in topics:
            # Validate topic
            if topic not in self.SUPPORTED_TOPICS:
                logger.warning(f"Unknown topic requested by {sid}: {topic}")
                continue

            # Check permission
            if not await check_topic_permission(user, topic):
                logger.warning(f"Permission denied for {sid} to subscribe to {topic}")
                denied.append(topic)
                continue

            # Join room
            room = f"topic_{topic}"
            await sio.enter_room(sid, room)
            subscribed.add(topic)
            joined.append(topic)
            logger.info(f"{sid} is entering room {room} [{self.namespace}]")

        # Update session
        session['subscribed_topics'] = subscribed
        await sio.save_session(sid, session)

        # Send response
        await sio.emit('subscribed', {
            'topics': list(subscribed),
            'joined': joined,
            'denied': denied if denied else None,
        }, to=sid, namespace=self.namespace)

    async def on_unsubscribe(self, sid: str, data: dict):
        """
        Handle topic unsubscription request.

        Leaves rooms for requested topics.

        Args:
            sid: Session ID
            data: Dict with 'topics' list, e.g. {'topics': ['aircraft']}

        Emits:
            'unsubscribed' with list of unsubscribed topics
        """
        topics = data.get('topics', [])
        if isinstance(topics, str):
            topics = [topics]

        session = await sio.get_session(sid)
        subscribed = session.get('subscribed_topics', set())

        left = []

        for topic in topics:
            if topic in subscribed:
                room = f"topic_{topic}"
                await sio.leave_room(sid, room)
                subscribed.discard(topic)
                left.append(topic)
                logger.debug(f"{sid} unsubscribed from {topic}")

        # Update session
        session['subscribed_topics'] = subscribed
        await sio.save_session(sid, session)

        # Send response
        await sio.emit('unsubscribed', {
            'topics': left,
            'remaining': list(subscribed),
        }, to=sid, namespace=self.namespace)

    async def on_request(self, sid: str, data: dict):
        """
        Handle request/response pattern.

        Processes data requests and returns responses.

        Args:
            sid: Session ID
            data: Dict with 'type', 'request_id', and optional 'params'
                  e.g. {'type': 'aircraft', 'request_id': 'req123', 'params': {'icao': 'ABC123'}}

        Emits:
            'response' with {type: 'response', request_id, request_type, data}
            or 'error' with {type: 'error', request_id, message}
        """
        request_type = data.get('type')
        request_id = data.get('request_id')
        params = data.get('params', {})

        if not request_type:
            await self._emit_error(sid, request_id, 'Missing request type')
            return

        # Check permission for this request type
        if not await self._check_request_permission(sid, request_type):
            await self._emit_error(sid, request_id, 'Permission denied')
            return

        try:
            # Route to appropriate handler
            handler = getattr(self, f'_handle_{request_type.replace("-", "_")}', None)
            if handler:
                result = await handler(params)
                await self._emit_response(sid, request_id, request_type, result)
            else:
                # Try generic handlers based on request type
                result = await self._handle_generic_request(request_type, params)
                if result is not None:
                    await self._emit_response(sid, request_id, request_type, result)
                else:
                    await self._emit_error(sid, request_id, f'Unknown request type: {request_type}')
        except Exception as e:
            logger.exception(f"Error handling request {request_type} for {sid}: {e}")
            await self._emit_error(sid, request_id, 'Internal server error')

    async def on_ping(self, sid: str, data: Optional[dict] = None):
        """Handle ping request for connection keepalive."""
        await sio.emit('pong', {
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }, to=sid, namespace=self.namespace)

    # =========================================================================
    # Private Helper Methods
    # =========================================================================

    async def _join_default_rooms(self, sid: str, user):
        """Join default rooms based on user permissions."""
        session = await sio.get_session(sid)
        subscribed = session.get('subscribed_topics', set())

        # Always join aircraft room if permitted
        if await check_topic_permission(user, 'aircraft'):
            await sio.enter_room(sid, 'topic_aircraft')
            subscribed.add('aircraft')

        # Join stats room (usually public)
        if await check_topic_permission(user, 'stats'):
            await sio.enter_room(sid, 'topic_stats')
            subscribed.add('stats')

        # Update session
        session['subscribed_topics'] = subscribed
        await sio.save_session(sid, session)

    async def _send_initial_state(self, sid: str):
        """Send initial aircraft snapshot on connect."""
        logger.info(f"[_send_initial_state] Starting for {sid}")
        try:
            aircraft_list = await self._get_current_aircraft()
            logger.info(f"[_send_initial_state] Got {len(aircraft_list)} aircraft from cache")
            await sio.emit('aircraft:snapshot', {
                'aircraft': aircraft_list,
                'count': len(aircraft_list),
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }, to=sid, namespace=self.namespace)
            logger.info(f"[_send_initial_state] Emitted aircraft:snapshot to {sid}")
        except Exception as e:
            logger.error(f"Failed to send aircraft snapshot to {sid}: {e}", exc_info=True)

    async def _check_request_permission(self, sid: str, request_type: str) -> bool:
        """Check if the session user has permission for this request type."""
        # Check if this request type requires a specific permission
        required_perm = self.REQUEST_PERMISSIONS.get(request_type)

        if not required_perm:
            return True  # No specific permission required

        session = await sio.get_session(sid)
        user = session.get('user')

        if not user or not user.is_authenticated:
            return await self._is_feature_public(required_perm)

        if user.is_superuser:
            return True

        return await self._check_user_permission(user, required_perm)

    async def _emit_response(self, sid: str, request_id: str, request_type: str, data):
        """Emit a response to a request."""
        await sio.emit('response', {
            'type': 'response',
            'request_id': request_id,
            'request_type': request_type,
            'data': data
        }, to=sid, namespace=self.namespace)

    async def _emit_error(self, sid: str, request_id: Optional[str], message: str):
        """Emit an error response."""
        await sio.emit('error', {
            'type': 'error',
            'request_id': request_id,
            'message': message
        }, to=sid, namespace=self.namespace)

    # =========================================================================
    # Request Handlers (ported from AircraftConsumer)
    # =========================================================================

    async def _handle_generic_request(self, request_type: str, params: dict):
        """Handle generic request types."""
        # Map request types to handler methods
        handlers = {
            'aircraft': self._handle_aircraft,
            'aircraft_list': self._handle_aircraft_list,
            'aircraft-info': self._handle_aircraft_info,
            'aircraft-info-bulk': self._handle_aircraft_info_bulk,
            'aircraft-stats': self._handle_aircraft_stats,
            'aircraft-top': self._handle_aircraft_top,
            'sightings': self._handle_sightings,
            'history-stats': self._handle_history_stats,
            'history-trends': self._handle_history_trends,
            'history-top': self._handle_history_top,
            'history-sessions': self._handle_history_sessions,
            'history-analytics-distance': self._handle_distance_analytics,
            'history-analytics-speed': self._handle_speed_analytics,
            'history-analytics-correlation': self._handle_correlation_analytics,
            'antenna-polar': self._handle_antenna_polar,
            'antenna-rssi': self._handle_antenna_rssi,
            'antenna-summary': self._handle_antenna_summary,
            'antenna-analytics': self._handle_antenna_analytics,
            'photo': self._handle_photo,
            'photo-cache': self._handle_photo,
            'safety-stats': self._handle_safety_stats,
            'safety-events': self._handle_safety_events,
            'acars-stats': self._handle_acars_stats,
            'safety-status': self._handle_safety_monitor_status,
            'airports': self._handle_airports,
            'navaids': self._handle_navaids,
            'airspaces': self._handle_airspace_advisories,
            'airspace-boundaries': self._handle_airspace_boundaries,
            'boundaries': self._handle_airspace_boundaries,
            'pireps': self._handle_pireps,
            'metars': self._handle_metars,
            'tafs': self._handle_tafs,
            'metar': self._handle_metar_single,
            'taf': self._handle_taf_single,
            'status': self._handle_status,
            'health': self._handle_health,
            'system-health': self._handle_health,
            'system-info': self._handle_system_info,
            'system-status': self._handle_system_status,
            'system-databases': self._handle_database_stats,
            'ws-status': self._handle_ws_status,
            # Extended stats endpoints
            'stats-flight-patterns': self._handle_flight_patterns,
            'stats-geographic': self._handle_geographic_stats,
            'stats-tracking-quality': self._handle_tracking_quality,
            'stats-engagement': self._handle_engagement_stats,
            'stats-favorites': self._handle_favorites_stats,
            'stats-time-comparison': self._handle_time_comparison,
        }

        handler = handlers.get(request_type)
        if handler:
            return await handler(params)
        return None

    async def _handle_aircraft(self, params: dict):
        """Return single aircraft by ICAO."""
        icao = params.get('icao') or params.get('hex')
        if not icao:
            raise ValueError('Missing icao parameter')
        return await self._get_aircraft_by_icao(icao)

    async def _handle_aircraft_list(self, params: dict):
        """Return list of aircraft with optional filters."""
        return await self._get_aircraft_list(params)

    async def _handle_aircraft_info(self, params: dict):
        """Get detailed aircraft info."""
        icao = params.get('icao') or params.get('hex')
        if not icao:
            raise ValueError('Missing icao parameter')
        return await self._get_aircraft_info(icao)

    async def _handle_aircraft_info_bulk(self, params: dict):
        """Get detailed aircraft info for multiple ICAOs."""
        icaos = params.get('icaos', [])
        if not icaos or not isinstance(icaos, list):
            raise ValueError('Missing or invalid icaos parameter (expected list)')
        return await self._get_aircraft_info_bulk(icaos)

    async def _handle_aircraft_stats(self, params: dict):
        """Get live aircraft statistics."""
        return await self._get_aircraft_stats()

    async def _handle_aircraft_top(self, params: dict):
        """Get top aircraft by category."""
        return await self._get_top_aircraft()

    async def _handle_sightings(self, params: dict):
        """Get historical sightings."""
        return await self._get_sightings(params)

    async def _handle_history_stats(self, params: dict):
        """Get history statistics."""
        return await self._get_history_stats(params)

    async def _handle_history_trends(self, params: dict):
        """Get traffic trends."""
        return await self._get_history_trends(params)

    async def _handle_history_top(self, params: dict):
        """Get top performers."""
        return await self._get_history_top(params)

    async def _handle_history_sessions(self, params: dict):
        """Get aircraft sessions."""
        return await self._get_history_sessions(params)

    async def _handle_distance_analytics(self, params: dict):
        """Get distance analytics."""
        return await self._get_distance_analytics(params)

    async def _handle_speed_analytics(self, params: dict):
        """Get speed analytics."""
        return await self._get_speed_analytics(params)

    async def _handle_correlation_analytics(self, params: dict):
        """Get correlation analytics."""
        return await self._get_correlation_analytics(params)

    async def _handle_antenna_polar(self, params: dict):
        """Get antenna polar coverage."""
        return await self._get_antenna_polar(params)

    async def _handle_antenna_rssi(self, params: dict):
        """Get RSSI vs distance data."""
        return await self._get_antenna_rssi(params)

    async def _handle_antenna_summary(self, params: dict):
        """Get antenna performance summary."""
        return await self._get_antenna_summary(params)

    async def _handle_antenna_analytics(self, params: dict):
        """Get all antenna analytics data."""
        return await self._get_antenna_analytics(params)

    async def _handle_photo(self, params: dict):
        """Get aircraft photo URL."""
        icao = params.get('icao') or params.get('hex')
        if not icao:
            raise ValueError('Missing icao parameter')
        return await self._get_aircraft_photo(icao, params)

    async def _handle_safety_stats(self, params: dict):
        """Get safety statistics."""
        return await self._get_safety_stats()

    async def _handle_safety_events(self, params: dict):
        """Get recent safety events."""
        return await self._get_safety_events(params)

    async def _handle_acars_stats(self, params: dict):
        """Get ACARS statistics."""
        return await self._get_acars_stats()

    async def _handle_safety_monitor_status(self, params: dict):
        """Get safety monitor status."""
        return await self._get_safety_monitor_status()

    async def _handle_airports(self, params: dict):
        """Get nearby airports."""
        return await self._get_airports(params)

    async def _handle_navaids(self, params: dict):
        """Get nearby navaids."""
        return await self._get_navaids(params)

    async def _handle_airspace_boundaries(self, params: dict):
        """Get airspace boundaries."""
        return await self._get_airspace_boundaries(params)

    async def _handle_airspace_advisories(self, params: dict):
        """Get airspace advisories (G-AIRMETs, SIGMETs)."""
        return await self._get_airspace_advisories(params)

    async def _handle_status(self, params: dict):
        """Get basic system status."""
        return await self._get_system_status()

    async def _handle_health(self, params: dict):
        """Get service health checks."""
        return await self._get_health_status()

    async def _handle_system_info(self, params: dict):
        """Get system information."""
        return await self._get_system_info()

    async def _handle_system_status(self, params: dict):
        """Get detailed system status."""
        return await self._get_detailed_system_status()

    async def _handle_database_stats(self, params: dict):
        """Get database statistics."""
        return await self._get_database_stats()

    async def _handle_ws_status(self, params: dict):
        """Get WebSocket service status."""
        # Get connected client count from Socket.IO engine
        try:
            socketio_connections = len(sio.eio.sockets) if hasattr(sio, 'eio') and hasattr(sio.eio, 'sockets') else 0
        except Exception:
            socketio_connections = 0

        return {
            'namespace': self.namespace,
            'supported_topics': self.SUPPORTED_TOPICS,
            'socketio_connections': socketio_connections,
            'subscribers': socketio_connections,  # Alias for frontend compatibility
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    # =========================================================================
    # Data Access Methods (ported from AircraftConsumer)
    # =========================================================================

    @sync_to_async
    def _get_current_aircraft(self):
        """Get current tracked aircraft from cache."""
        cached = cache.get('current_aircraft')
        if cached:
            return cached
        return []

    @sync_to_async
    def _get_aircraft_by_icao(self, icao: str):
        """Get single aircraft by ICAO hex code."""
        cached = cache.get('current_aircraft')
        if cached:
            for ac in cached:
                if ac.get('hex') == icao or ac.get('icao_hex') == icao:
                    return ac
        return None

    @sync_to_async
    def _get_aircraft_list(self, filters: dict):
        """Get filtered aircraft list."""
        cached = cache.get('current_aircraft')
        if not cached:
            return []

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

    @sync_to_async
    def _get_aircraft_info(self, icao: str):
        """Get detailed aircraft info from database."""
        from skyspy.models import AircraftInfo

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

    @sync_to_async
    def _get_aircraft_info_bulk(self, icaos: list):
        """Get detailed aircraft info for multiple ICAOs."""
        from skyspy.models import AircraftInfo

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
    def _get_aircraft_stats(self):
        """Get live aircraft statistics."""
        cached = cache.get('current_aircraft', [])

        military = sum(1 for ac in cached if ac.get('military'))
        emergency = sum(1 for ac in cached if ac.get('emergency'))

        categories = {}
        for ac in cached:
            cat = ac.get('category', 'Unknown')
            categories[cat] = categories.get(cat, 0) + 1

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
    def _get_top_aircraft(self):
        """Get top 5 aircraft by various metrics."""
        cached = cache.get('current_aircraft', [])
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

    @sync_to_async
    def _get_sightings(self, params: dict):
        """Get historical sightings."""
        from skyspy.models import AircraftSighting

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

        sightings = list(queryset.order_by('-timestamp')[offset:offset + limit].values(
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

    @sync_to_async
    def _get_history_stats(self, params: dict):
        """Get history statistics."""
        from skyspy.models import AircraftSighting

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

    @sync_to_async
    def _get_history_trends(self, params: dict):
        """Get traffic trends."""
        from skyspy.models import AircraftSighting

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

    @sync_to_async
    def _get_history_top(self, params: dict):
        """Get top performers."""
        from skyspy.models import AircraftSession

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

    @sync_to_async
    def _get_history_sessions(self, params: dict):
        """Get aircraft sessions."""
        from skyspy.models import AircraftSession

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

    @sync_to_async
    def _get_distance_analytics(self, params: dict):
        """Get distance analytics."""
        from skyspy.models import AircraftSession

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

    @sync_to_async
    def _get_speed_analytics(self, params: dict):
        """Get speed analytics."""
        from skyspy.models import AircraftSighting

        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            ground_speed__isnull=False,
            ground_speed__gt=0
        )

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

    @sync_to_async
    def _get_correlation_analytics(self, params: dict):
        """Get correlation analytics."""
        from skyspy.models import AircraftSighting

        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(timestamp__gte=cutoff)

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

    @sync_to_async
    def _get_antenna_polar(self, params: dict):
        """Get antenna polar coverage data."""
        from skyspy.models import AircraftSighting

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

    @sync_to_async
    def _get_antenna_rssi(self, params: dict):
        """Get RSSI vs distance data."""
        from skyspy.models import AircraftSighting

        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        sample_size = _parse_int_param(params.get('sample_size'), 500, min_val=1, max_val=1000)
        cutoff = timezone.now() - timedelta(hours=hours)

        sightings = AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            rssi__isnull=False,
            distance_nm__isnull=False,
            distance_nm__gt=0
        )

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

    @sync_to_async
    def _get_antenna_summary(self, params: dict):
        """Get antenna performance summary."""
        from skyspy.models import AircraftSighting

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

    async def _get_antenna_analytics(self, params: dict):
        """Get all antenna analytics combined."""
        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)

        polar_data = await self._get_polar_sync(hours)
        rssi_data = await self._get_rssi_sync(hours)
        summary_data = await self._get_summary_sync(hours)

        return {
            'polar': polar_data,
            'rssi': rssi_data,
            'summary': summary_data,
            'hours': hours
        }

    @sync_to_async
    def _get_polar_sync(self, hours):
        """Synchronous polar data fetch."""
        from skyspy.models import AircraftSighting

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

    @sync_to_async
    def _get_rssi_sync(self, hours):
        """Synchronous RSSI data fetch."""
        from skyspy.models import AircraftSighting

        cutoff = timezone.now() - timedelta(hours=hours)
        return list(AircraftSighting.objects.filter(
            timestamp__gte=cutoff,
            rssi__isnull=False,
            distance_nm__isnull=False
        ).order_by('-timestamp').values('distance_nm', 'rssi')[:200])

    @sync_to_async
    def _get_summary_sync(self, hours):
        """Synchronous summary data fetch."""
        from skyspy.models import AircraftSighting

        cutoff = timezone.now() - timedelta(hours=hours)
        return AircraftSighting.objects.filter(
            timestamp__gte=cutoff
        ).aggregate(
            total=Count('id'),
            max_range=Max('distance_nm'),
            avg_rssi=Avg('rssi')
        )

    @sync_to_async
    def _get_aircraft_photo(self, icao: str, params: dict):
        """Get aircraft photo URL."""
        from pathlib import Path

        from skyspy.models import AircraftInfo

        icao = icao.upper()
        prefer_thumbnail = params.get('thumbnail', False)

        photo_url = None
        thumbnail_url = None

        if getattr(settings, 'PHOTO_CACHE_ENABLED', False):
            if getattr(settings, 'S3_ENABLED', False):
                from skyspy.services.photo_cache import get_photo_url as get_cached_url
                if get_cached_url(icao, is_thumbnail=False, verify_exists=True):
                    photo_url = f"/api/v1/photos/{icao}"
                if get_cached_url(icao, is_thumbnail=True, verify_exists=True):
                    thumbnail_url = f"/api/v1/photos/{icao}/thumb"
            else:
                cache_dir = Path(settings.PHOTO_CACHE_DIR)
                photo_path = cache_dir / f"{icao}.jpg"
                thumb_path = cache_dir / f"{icao}_thumb.jpg"
                if photo_path.exists() and photo_path.stat().st_size > 0:
                    photo_url = f"/api/v1/photos/{icao}"
                if thumb_path.exists() and thumb_path.stat().st_size > 0:
                    thumbnail_url = f"/api/v1/photos/{icao}/thumb"

        photographer = None
        source = None
        page_link = None

        try:
            info = AircraftInfo.objects.filter(icao_hex=icao).first()
            if info:
                photographer = info.photo_photographer
                source = info.photo_source
                page_link = info.photo_page_link
        except Exception:
            pass

        return {
            'icao': icao,
            'photo_url': photo_url,
            'photo_thumbnail_url': thumbnail_url,
            'photo_page_link': page_link,
            'photo_photographer': photographer,
            'photo_source': source,
        }

    @sync_to_async
    def _get_safety_stats(self):
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

    @sync_to_async
    def _get_safety_events(self, params: dict):
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

    @sync_to_async
    def _get_safety_monitor_status(self):
        """Get safety monitor status."""
        enabled = getattr(settings, 'SAFETY_MONITORING_ENABLED', True)
        tracked_aircraft = 0

        try:
            from skyspy.services.safety import safety_monitor
            stats = safety_monitor.get_stats()
            tracked_aircraft = stats.get('tracked_aircraft', 0)
        except Exception:
            pass

        return {
            'enabled': enabled,
            'tracked_aircraft': tracked_aircraft,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }

    @sync_to_async
    def _get_acars_stats(self):
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

    @sync_to_async
    def _get_airports(self, params: dict):
        """Get nearby airports."""
        from skyspy.models import CachedAirport

        lat = params.get('lat', getattr(settings, 'FEEDER_LAT', 0))
        lon = params.get('lon', getattr(settings, 'FEEDER_LON', 0))
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

    @sync_to_async
    def _get_navaids(self, params: dict):
        """Get nearby navigation aids."""
        from skyspy.models import CachedNavaid

        lat = params.get('lat', getattr(settings, 'FEEDER_LAT', 0))
        lon = params.get('lon', getattr(settings, 'FEEDER_LON', 0))
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

    @sync_to_async
    def _get_airspace_boundaries(self, params: dict):
        """Get airspace boundaries."""
        from skyspy.models import AirspaceBoundary

        lat = params.get('lat', getattr(settings, 'FEEDER_LAT', 0))
        lon = params.get('lon', getattr(settings, 'FEEDER_LON', 0))
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

    async def _handle_pireps(self, params: dict):
        """Handle PIREPs request."""
        return await self._get_pireps(params)

    async def _handle_metars(self, params: dict):
        """Handle METARs request."""
        return await self._get_metars(params)

    async def _handle_tafs(self, params: dict):
        """Handle TAFs request."""
        return await self._get_tafs(params)

    async def _handle_metar_single(self, params: dict):
        """Handle single METAR request by station."""
        station = params.get('station') or params.get('icao')
        if not station:
            raise ValueError('Missing station parameter')
        return await self._get_metar_by_station(station)

    async def _handle_taf_single(self, params: dict):
        """Handle single TAF request by station."""
        station = params.get('station') or params.get('icao')
        if not station:
            raise ValueError('Missing station parameter')
        return await self._get_taf_by_station(station)

    @sync_to_async
    def _get_pireps(self, params: dict):
        """Get PIREP data with spatial filtering."""
        from math import cos, pi

        from skyspy.models import CachedPirep

        hours = _parse_int_param(params.get('hours'), 6, min_val=1, max_val=24)
        lat = params.get('lat', getattr(settings, 'FEEDER_LAT', 0))
        lon = params.get('lon', getattr(settings, 'FEEDER_LON', 0))
        radius_nm = params.get('radius', params.get('radius_nm', 500))

        # Build cache key
        cache_key = f"pireps_ws:{hours}:{round(lat, 2)}:{round(lon, 2)}:{round(radius_nm)}"
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return cached_data

        cutoff = timezone.now() - timedelta(hours=hours)
        query = CachedPirep.objects.filter(observation_time__gte=cutoff)

        # Spatial filtering
        try:
            lat = float(lat)
            lon = float(lon)
            radius = float(radius_nm) if radius_nm else 500

            lat_delta = radius / 60.0
            lon_delta = radius / (60.0 * max(cos(lat * pi / 180), 0.1))

            query = query.filter(
                latitude__gte=lat - lat_delta,
                latitude__lte=lat + lat_delta,
                longitude__gte=lon - lon_delta,
                longitude__lte=lon + lon_delta,
            )
        except (ValueError, TypeError):
            pass

        pireps = query.order_by('-observation_time')[:100]

        result = []
        for p in pireps:
            result.append({
                'id': p.id,
                'raw': p.raw_text,
                'lat': p.latitude,
                'lon': p.longitude,
                'altitude': p.altitude_ft,
                'observation_time': p.observation_time.isoformat() if p.observation_time else None,
                'aircraft_type': p.aircraft_type,
                'report_type': p.report_type,
                'turbulence': p.turbulence_intensity,
                'icing': p.icing_intensity,
                'sky_cover': p.sky_cover,
                'weather': p.weather,
                'visibility': p.visibility_sm,
                'temp': p.temperature_c,
            })

        response = {
            'data': result,
            'count': len(result),
            'source': 'aviationweather.gov',
        }

        # Cache for 2 minutes
        cache.set(cache_key, response, timeout=120)
        return response

    @sync_to_async
    def _get_metars(self, params: dict):
        """Get METAR data for area."""
        from skyspy.services import weather_cache

        lat = params.get('lat', getattr(settings, 'FEEDER_LAT', 0))
        lon = params.get('lon', getattr(settings, 'FEEDER_LON', 0))
        radius_nm = params.get('radius', params.get('radius_nm', 200))
        hours = _parse_int_param(params.get('hours'), 2, min_val=1, max_val=24)

        try:
            lat = float(lat)
            lon = float(lon)
            radius_nm = float(radius_nm)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60
            bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
        except (ValueError, TypeError):
            bbox = "24,-130,50,-60"  # CONUS default

        metars = weather_cache.fetch_and_cache_metars(bbox=bbox, hours=hours)

        return {
            'data': metars,
            'count': len(metars),
            'source': 'aviationweather.gov',
        }

    @sync_to_async
    def _get_tafs(self, params: dict):
        """Get TAF data for area."""
        from skyspy.services import weather_cache

        lat = params.get('lat', getattr(settings, 'FEEDER_LAT', 0))
        lon = params.get('lon', getattr(settings, 'FEEDER_LON', 0))
        radius_nm = params.get('radius', params.get('radius_nm', 200))

        try:
            lat = float(lat)
            lon = float(lon)
            radius_nm = float(radius_nm)
            lat_delta = radius_nm / 60
            lon_delta = radius_nm / 60
            bbox = f"{lat - lat_delta},{lon - lon_delta},{lat + lat_delta},{lon + lon_delta}"
        except (ValueError, TypeError):
            bbox = "24,-130,50,-60"  # CONUS default

        tafs = weather_cache.fetch_and_cache_tafs(bbox=bbox)

        return {
            'data': tafs,
            'count': len(tafs),
            'source': 'aviationweather.gov',
        }

    @sync_to_async
    def _get_metar_by_station(self, station: str):
        """Get METAR for a single station."""
        from skyspy.services import weather_cache

        metar = weather_cache.fetch_metar_by_station(station.upper(), hours=2)
        if metar:
            return {
                'station': station.upper(),
                'data': metar[0] if isinstance(metar, list) and metar else metar,
                'source': 'aviationweather.gov',
            }
        return {'station': station.upper(), 'data': None, 'error': 'No METAR found'}

    @sync_to_async
    def _get_taf_by_station(self, station: str):
        """Get TAF for a single station."""
        from skyspy.services import weather_cache

        taf = weather_cache.fetch_taf_by_station(station.upper())
        if taf:
            return {
                'station': station.upper(),
                'data': taf[0] if isinstance(taf, list) and taf else taf,
                'source': 'aviationweather.gov',
            }
        return {'station': station.upper(), 'data': None, 'error': 'No TAF found'}

    @sync_to_async
    def _get_airspace_advisories(self, params: dict):
        """Get active airspace advisories (G-AIRMETs, SIGMETs)."""
        from skyspy.models import AirspaceAdvisory

        now = timezone.now()
        advisories = AirspaceAdvisory.objects.filter(
            valid_from__lte=now,
            valid_to__gte=now
        ).order_by('-fetched_at')

        hazard = params.get('hazard')
        if hazard:
            advisories = advisories.filter(hazard=hazard)

        result = []
        for adv in advisories[:100]:
            result.append({
                'id': adv.id,
                'advisory_type': adv.advisory_type,
                'hazard': adv.hazard,
                'severity': adv.severity,
                'valid_from': adv.valid_from.isoformat() if adv.valid_from else None,
                'valid_to': adv.valid_to.isoformat() if adv.valid_to else None,
                'upper_alt_ft': adv.upper_alt_ft,
                'lower_alt_ft': adv.lower_alt_ft,
                'polygon': adv.polygon,
            })

        return {
            'advisories': result,
            'count': len(result),
        }

    @sync_to_async
    def _get_system_status(self):
        """Get basic system status."""
        aircraft_list = cache.get('current_aircraft', [])
        adsb_online = cache.get('adsb_online', False)
        celery_ok = cache.get('celery_heartbeat', False)

        return {
            'online': adsb_online,
            'aircraft_count': len(aircraft_list),
            'celery_running': celery_ok,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @sync_to_async
    def _get_health_status(self):
        """Get service health checks."""
        from django.db import connection

        health = {
            'status': 'healthy',
            'services': {}
        }

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            health['services']['database'] = {'status': 'up'}
        except Exception as e:
            health['services']['database'] = {'status': 'down', 'error': str(e)}
            health['status'] = 'unhealthy'

        adsb_online = cache.get('adsb_online', False)
        health['services']['adsb'] = {
            'status': 'up' if adsb_online else 'down'
        }

        celery_ok = cache.get('celery_heartbeat', False)
        health['services']['celery'] = {
            'status': 'up' if celery_ok else 'unknown'
        }

        try:
            cache.set('_health_check', True, timeout=5)
            cache.get('_health_check')
            health['services']['cache'] = {'status': 'up'}
        except Exception as e:
            health['services']['cache'] = {'status': 'down', 'error': str(e)}
            health['status'] = 'degraded'

        health['timestamp'] = datetime.utcnow().isoformat() + 'Z'
        return health

    async def _get_system_info(self):
        """Get system information."""
        import platform
        import sys

        return {
            'version': getattr(settings, 'VERSION', '1.0.0'),
            'python_version': sys.version,
            'platform': platform.platform(),
            'django_version': __import__('django').get_version(),
            'debug': settings.DEBUG,
            'feeder': {
                'latitude': getattr(settings, 'FEEDER_LAT', None),
                'longitude': getattr(settings, 'FEEDER_LON', None),
            },
            'features': {
                'acars_enabled': getattr(settings, 'ACARS_ENABLED', False),
                'safety_monitoring': getattr(settings, 'SAFETY_MONITORING_ENABLED', True),
                'photo_cache': getattr(settings, 'PHOTO_CACHE_ENABLED', False),
                's3_storage': getattr(settings, 'S3_ENABLED', False),
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @sync_to_async
    def _get_detailed_system_status(self):
        """Get detailed system status."""
        from skyspy.models import AcarsMessage, AircraftSighting, SafetyEvent

        aircraft_list = cache.get('current_aircraft', [])

        cutoff_24h = timezone.now() - timedelta(hours=24)

        sighting_count = AircraftSighting.objects.filter(timestamp__gte=cutoff_24h).count()
        safety_count = SafetyEvent.objects.filter(timestamp__gte=cutoff_24h).count()
        acars_count = AcarsMessage.objects.filter(timestamp__gte=cutoff_24h).count()

        return {
            'aircraft': {
                'current': len(aircraft_list),
                'military': sum(1 for ac in aircraft_list if ac.get('military')),
                'emergency': sum(1 for ac in aircraft_list if ac.get('emergency')),
            },
            'last_24h': {
                'sightings': sighting_count,
                'safety_events': safety_count,
                'acars_messages': acars_count,
            },
            'receiver': {
                'online': cache.get('adsb_online', False),
                'messages': cache.get('aircraft_messages', 0),
            },
            'feeder': {
                'latitude': getattr(settings, 'FEEDER_LAT', None),
                'longitude': getattr(settings, 'FEEDER_LON', None),
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @sync_to_async
    def _get_database_stats(self):
        """Get external database statistics."""
        from skyspy.models import AircraftInfo

        total = AircraftInfo.objects.count()
        with_photos = AircraftInfo.objects.exclude(photo_url__isnull=True).exclude(photo_url='').count()
        military = AircraftInfo.objects.filter(is_military=True).count()
        failed = AircraftInfo.objects.filter(fetch_failed=True).count()

        return {
            'aircraft_info': {
                'total': total,
                'with_photos': with_photos,
                'military': military,
                'failed_lookups': failed,
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    @sync_to_async
    def _is_feature_public(self, permission: str) -> bool:
        """Check if the feature for this permission is publicly accessible."""
        from skyspy.models.auth import FeatureAccess

        feature = permission.split('.')[0]

        try:
            config = FeatureAccess.objects.get(feature=feature)
            return config.read_access == 'public'
        except FeatureAccess.DoesNotExist:
            return False

    @sync_to_async
    def _check_user_permission(self, user, permission: str) -> bool:
        """Check if an authenticated user has a specific permission."""
        try:
            profile = user.skyspy_profile
            return profile.has_permission(permission)
        except Exception as e:
            logger.debug(f"Error checking user permission: {e}")
            return False

    # =========================================================================
    # Extended Stats Handlers
    # =========================================================================

    async def _handle_flight_patterns(self, params: dict):
        """Get flight pattern statistics."""
        return await self._get_flight_patterns(params)

    async def _handle_geographic_stats(self, params: dict):
        """Get geographic statistics."""
        return await self._get_geographic_stats(params)

    async def _handle_tracking_quality(self, params: dict):
        """Get tracking quality metrics."""
        return await self._get_tracking_quality(params)

    async def _handle_engagement_stats(self, params: dict):
        """Get engagement statistics."""
        return await self._get_engagement_stats(params)

    async def _handle_favorites_stats(self, params: dict):
        """Get favorites statistics."""
        return await self._get_favorites_stats(params)

    async def _handle_time_comparison(self, params: dict):
        """Get time comparison statistics."""
        return await self._get_time_comparison(params)

    @sync_to_async
    def _get_flight_patterns(self, params: dict):
        """Get flight pattern statistics from cache or calculate."""
        from skyspy.services.stats_cache import get_flight_patterns_stats

        return get_flight_patterns_stats() or {}

    @sync_to_async
    def _get_geographic_stats(self, params: dict):
        """Get geographic statistics from cache or calculate."""
        from skyspy.services.stats_cache import get_geographic_stats

        return get_geographic_stats() or {}

    @sync_to_async
    def _get_tracking_quality(self, params: dict):
        """Get tracking quality metrics from cache or calculate."""
        from skyspy.services.stats_cache import get_tracking_quality_stats

        return get_tracking_quality_stats() or {}

    @sync_to_async
    def _get_engagement_stats(self, params: dict):
        """Get engagement statistics from cache or calculate."""
        from skyspy.services.stats_cache import get_engagement_stats

        return get_engagement_stats() or {}

    @sync_to_async
    def _get_favorites_stats(self, params: dict):
        """Get favorites statistics."""
        from skyspy.models import AircraftFavorite

        hours = _parse_int_param(params.get('hours'), 24, min_val=1, max_val=720)
        cutoff = timezone.now() - timedelta(hours=hours)

        favorites = AircraftFavorite.objects.filter(
            created_at__gte=cutoff
        ).select_related('user').order_by('-created_at')[:50]

        return {
            'favorites': [
                {
                    'icao_hex': f.icao_hex,
                    'nickname': f.nickname,
                    'created_at': f.created_at.isoformat() if f.created_at else None,
                }
                for f in favorites
            ],
            'count': favorites.count() if hasattr(favorites, 'count') else len(favorites),
            'hours': hours,
        }

    @sync_to_async
    def _get_time_comparison(self, params: dict):
        """Get time comparison statistics."""
        from skyspy.services.time_comparison_stats import get_all_time_comparison_stats

        return get_all_time_comparison_stats() or {}


# Register the namespace with the Socket.IO server
main_namespace = MainNamespace('/')
sio.register_namespace(main_namespace)

logger.info("MainNamespace registered for '/' namespace")
