"""
Socket.IO management for real-time data streaming.

Provides Socket.IO connections for:
- Aircraft updates (positions, new/removed)
- Airspace advisories and boundaries
- Safety events
- ACARS messages
- Alerts
- Request/response for on-demand data (aviation data, PIREPs, etc.)

Supports Redis for multi-worker deployments.

## Events (Server -> Client)

### Push Events (automatic broadcasts)
- aircraft:snapshot - Initial aircraft state on connect
- aircraft:new - New aircraft detected
- aircraft:update - Aircraft position/state changed
- aircraft:remove - Aircraft no longer tracked
- aircraft:heartbeat - Periodic count update
- airspace:snapshot - Initial airspace state
- airspace:advisory - Advisory update
- airspace:boundary - Boundary update
- safety:event - Safety event (TCAS, conflicts)
- alert:triggered - Custom alert matched
- acars:message - ACARS/VDL2 message
- airframe:error - Airframe lookup error

### Response Events (on-demand requests)
- response - Response to a request
- error - Error response

## Events (Client -> Server)

- subscribe - Join topic rooms
- unsubscribe - Leave topic rooms
- request - Request data on-demand

## Rooms/Topics

Clients join rooms to receive specific event types:
- aircraft, airspace, safety, alerts, acars
"""
import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Optional

import socketio

from app.core.config import get_settings
from app.core.utils import calculate_distance_nm, is_valid_position

logger = logging.getLogger(__name__)
settings = get_settings()


class SocketIOManager:
    """Manages Socket.IO connections with room-based subscriptions."""

    def __init__(self):
        # Create Socket.IO server with ASGI support
        # Use Redis for multi-worker if configured
        if settings.redis_url:
            self.sio = socketio.AsyncServer(
                async_mode='asgi',
                cors_allowed_origins='*',
                logger=False,
                engineio_logger=False,
                client_manager=socketio.AsyncRedisManager(settings.redis_url)
            )
            self._using_redis = True
            logger.info(f"Socket.IO using Redis manager: {settings.redis_url}")
        else:
            self.sio = socketio.AsyncServer(
                async_mode='asgi',
                cors_allowed_origins='*',
                logger=False,
                engineio_logger=False,
            )
            self._using_redis = False
            logger.info("Socket.IO using in-memory manager (single worker)")

        # ASGI app for mounting
        self.app = socketio.ASGIApp(self.sio, socketio_path='/socket.io')

        # State tracking
        self._last_aircraft_state: dict = {}
        self._last_airspace_state: dict = {}
        self._last_publish_time: Optional[float] = None
        self._connection_count = 0

        # Filter tracking for stats subscriptions
        # Maps sid -> filter dict
        self._client_filters: dict[str, dict] = {}

        # Register event handlers
        self._register_handlers()

    def _register_handlers(self):
        """Register Socket.IO event handlers."""

        @self.sio.event
        async def connect(sid, environ, auth):
            """Handle client connection."""
            self._connection_count += 1
            logger.info(f"Socket.IO client connected: {sid} (total: {self._connection_count})")

            # Get topics from query params or auth
            query_string = environ.get('QUERY_STRING', '')
            topics = self._parse_topics(query_string)

            if not topics:
                topics = ['all']

            # Join topic rooms
            for topic in topics:
                await self.sio.enter_room(sid, topic)

            # Send initial state
            await self._send_initial_state(sid, topics)

        @self.sio.event
        async def disconnect(sid):
            """Handle client disconnection."""
            self._connection_count = max(0, self._connection_count - 1)
            # Clean up client filters
            if sid in self._client_filters:
                del self._client_filters[sid]
            logger.info(f"Socket.IO client disconnected: {sid} (total: {self._connection_count})")

        @self.sio.event
        async def subscribe(sid, data):
            """Handle topic subscription."""
            topics = data.get('topics', []) if isinstance(data, dict) else data
            if isinstance(topics, str):
                topics = [topics]

            for topic in topics:
                if topic in ['aircraft', 'airspace', 'safety', 'alerts', 'acars', 'audio', 'stats', 'all']:
                    await self.sio.enter_room(sid, topic)
                    logger.debug(f"Client {sid} subscribed to {topic}")

            # Send initial state for new topics
            await self._send_initial_state(sid, topics)

        @self.sio.event
        async def subscribe_stats(sid, data):
            """Handle stats subscription with filters."""
            filters = data if isinstance(data, dict) else {}

            # Store client's filter preferences
            self._client_filters[sid] = {
                'military_only': filters.get('military_only', False),
                'category': filters.get('category'),
                'min_altitude': filters.get('min_altitude'),
                'max_altitude': filters.get('max_altitude'),
                'min_distance': filters.get('min_distance'),
                'max_distance': filters.get('max_distance'),
                'aircraft_type': filters.get('aircraft_type'),
            }

            # Join stats room
            await self.sio.enter_room(sid, 'stats')
            logger.debug(f"Client {sid} subscribed to stats with filters: {self._client_filters[sid]}")

            # Send initial filtered stats
            await self._send_filtered_stats(sid)

        @self.sio.event
        async def update_stats_filters(sid, data):
            """Update stats filters for a client."""
            if sid not in self._client_filters:
                self._client_filters[sid] = {}

            filters = data if isinstance(data, dict) else {}
            self._client_filters[sid].update({
                'military_only': filters.get('military_only', self._client_filters[sid].get('military_only', False)),
                'category': filters.get('category', self._client_filters[sid].get('category')),
                'min_altitude': filters.get('min_altitude', self._client_filters[sid].get('min_altitude')),
                'max_altitude': filters.get('max_altitude', self._client_filters[sid].get('max_altitude')),
                'min_distance': filters.get('min_distance', self._client_filters[sid].get('min_distance')),
                'max_distance': filters.get('max_distance', self._client_filters[sid].get('max_distance')),
                'aircraft_type': filters.get('aircraft_type', self._client_filters[sid].get('aircraft_type')),
            })

            logger.debug(f"Client {sid} updated stats filters: {self._client_filters[sid]}")

            # Send updated filtered stats
            await self._send_filtered_stats(sid)

        @self.sio.event
        async def unsubscribe(sid, data):
            """Handle topic unsubscription."""
            topics = data.get('topics', []) if isinstance(data, dict) else data
            if isinstance(topics, str):
                topics = [topics]

            for topic in topics:
                await self.sio.leave_room(sid, topic)
                logger.debug(f"Client {sid} unsubscribed from {topic}")

        @self.sio.event
        async def request(sid, data):
            """Handle data request."""
            await self._handle_request(sid, data)

        @self.sio.event
        async def ping(sid, data=None):
            """Handle ping/pong keepalive."""
            await self.sio.emit('pong', {
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }, room=sid)

    def _parse_topics(self, query_string: str) -> list[str]:
        """Parse topics from query string."""
        topics = []
        for param in query_string.split('&'):
            if param.startswith('topics='):
                topics_str = param.split('=', 1)[1]
                topics = [t.strip() for t in topics_str.split(',') if t.strip()]
                break
        return topics

    async def _send_initial_state(self, sid: str, topics: list[str]):
        """Send current state to newly connected/subscribed client."""
        try:
            # Send aircraft state
            if 'aircraft' in topics or 'all' in topics:
                if self._last_aircraft_state:
                    await self.sio.emit('aircraft:snapshot', {
                        'aircraft': list(self._last_aircraft_state.values()),
                        'count': len(self._last_aircraft_state),
                        'timestamp': datetime.utcnow().isoformat() + 'Z'
                    }, room=sid)

            # Send airspace state
            if 'airspace' in topics or 'all' in topics:
                if self._last_airspace_state:
                    await self.sio.emit('airspace:snapshot', self._last_airspace_state, room=sid)

        except Exception as e:
            logger.warning(f"Failed to send initial state to {sid}: {e}")

    async def _send_filtered_stats(self, sid: str):
        """Send filtered stats to a specific client based on their filters."""
        try:
            filters = self._client_filters.get(sid, {})

            # Apply filters to current aircraft state
            aircraft_list = list(self._last_aircraft_state.values())
            filtered_aircraft = self._apply_aircraft_filters(aircraft_list, filters)

            # Calculate stats from filtered aircraft
            stats = self._calculate_stats(filtered_aircraft)
            stats['filters_applied'] = {k: v for k, v in filters.items() if v is not None}
            stats['timestamp'] = datetime.utcnow().isoformat() + 'Z'

            await self.sio.emit('stats:update', stats, room=sid)

        except Exception as e:
            logger.warning(f"Failed to send filtered stats to {sid}: {e}")

    def _apply_aircraft_filters(self, aircraft: list[dict], filters: dict) -> list[dict]:
        """Apply filters to aircraft list."""
        result = aircraft.copy()

        if filters.get('military_only'):
            result = [a for a in result if a.get('dbFlags', 0) & 1]

        if filters.get('category'):
            categories = [c.strip().upper() for c in filters['category'].split(',')]
            result = [a for a in result if a.get('category', '').upper() in categories]

        if filters.get('min_altitude') is not None:
            result = [a for a in result
                      if isinstance(a.get('alt_baro'), int) and a['alt_baro'] >= filters['min_altitude']]

        if filters.get('max_altitude') is not None:
            result = [a for a in result
                      if isinstance(a.get('alt_baro'), int) and a['alt_baro'] <= filters['max_altitude']]

        if filters.get('min_distance') is not None:
            result = [a for a in result
                      if a.get('distance_nm') is not None and a['distance_nm'] >= filters['min_distance']]

        if filters.get('max_distance') is not None:
            result = [a for a in result
                      if a.get('distance_nm') is not None and a['distance_nm'] <= filters['max_distance']]

        return result

    def _calculate_stats(self, aircraft: list[dict]) -> dict:
        """Calculate stats from aircraft list."""
        total = len(aircraft)
        with_position = sum(1 for a in aircraft if a.get('lat') and a.get('lon'))
        military = sum(1 for a in aircraft if a.get('dbFlags', 0) & 1)

        # Category breakdown
        categories = {}
        for a in aircraft:
            cat = a.get('category', 'unknown')
            categories[cat] = categories.get(cat, 0) + 1

        # Altitude breakdown
        altitudes = [a['alt_baro'] for a in aircraft if isinstance(a.get('alt_baro'), int)]
        alt_ground = sum(1 for alt in altitudes if alt <= 0)
        alt_low = sum(1 for alt in altitudes if 0 < alt < 10000)
        alt_med = sum(1 for alt in altitudes if 10000 <= alt < 30000)
        alt_high = sum(1 for alt in altitudes if alt >= 30000)

        return {
            'total': total,
            'with_position': with_position,
            'military': military,
            'categories': categories,
            'altitude': {
                'ground': alt_ground,
                'low': alt_low,
                'medium': alt_med,
                'high': alt_high
            },
            'avg_altitude': round(sum(altitudes) / len(altitudes)) if altitudes else None,
            'max_altitude': max(altitudes) if altitudes else None,
        }

    async def _handle_request(self, sid: str, data: dict):
        """Handle on-demand data request."""
        request_type = data.get('type')
        request_id = data.get('request_id', str(time.time()))
        params = data.get('params', {})

        timestamp = datetime.utcnow().isoformat() + 'Z'

        try:
            from app.core.database import AsyncSessionLocal
            from app.services.websocket import fetch_requested_data

            async with AsyncSessionLocal() as db:
                result = await fetch_requested_data(request_type, params, db)

            await self.sio.emit('response', {
                'request_id': request_id,
                'request_type': request_type,
                'data': result,
                'timestamp': timestamp
            }, room=sid)

        except Exception as e:
            logger.error(f"Socket.IO request error ({request_type}): {e}")
            await self.sio.emit('error', {
                'request_id': request_id,
                'request_type': request_type,
                'error': str(e),
                'timestamp': timestamp
            }, room=sid)

    # =========================================================================
    # Broadcast Methods (called by application)
    # =========================================================================

    async def broadcast_to_room(self, room: str, event: str, data: dict):
        """Broadcast event to a room and 'all' room."""
        self._last_publish_time = time.time()

        # Emit to specific room
        await self.sio.emit(event, data, room=room)

        # Also emit to 'all' room if not already the target
        if room != 'all':
            await self.sio.emit(event, data, room='all')

    async def broadcast_filtered_stats(self):
        """Broadcast filtered stats to all clients with stats subscriptions."""
        for sid, filters in self._client_filters.items():
            try:
                await self._send_filtered_stats(sid)
            except Exception as e:
                logger.warning(f"Failed to broadcast stats to {sid}: {e}")

    async def publish_aircraft_update(self, aircraft_list: list[dict]):
        """Publish aircraft updates, detecting changes."""
        current_state = {}
        new_aircraft = []
        updated_aircraft = []
        removed_icaos = []

        for ac in aircraft_list:
            icao = ac.get('hex', '').upper()
            if not icao:
                continue
            current_state[icao] = ac

            if icao not in self._last_aircraft_state:
                new_aircraft.append(ac)
            else:
                old = self._last_aircraft_state[icao]
                if self._has_significant_change(old, ac):
                    updated_aircraft.append(ac)

        for icao in self._last_aircraft_state:
            if icao not in current_state:
                removed_icaos.append(icao)

        self._last_aircraft_state = current_state
        timestamp = datetime.utcnow().isoformat() + 'Z'

        if new_aircraft:
            await self.broadcast_to_room('aircraft', 'aircraft:new', {
                'aircraft': [self._simplify_aircraft(ac) for ac in new_aircraft],
                'timestamp': timestamp
            })

        if updated_aircraft:
            await self.broadcast_to_room('aircraft', 'aircraft:update', {
                'aircraft': [self._simplify_aircraft(ac) for ac in updated_aircraft],
                'timestamp': timestamp
            })

        if removed_icaos:
            await self.broadcast_to_room('aircraft', 'aircraft:remove', {
                'icaos': removed_icaos,
                'timestamp': timestamp
            })

        # Heartbeat
        await self.broadcast_to_room('aircraft', 'aircraft:heartbeat', {
            'count': len(current_state),
            'timestamp': timestamp
        })

        # Send filtered stats to all stats subscribers
        await self.broadcast_filtered_stats()

    def _has_significant_change(self, old: dict, new: dict) -> bool:
        """Check if aircraft has changed significantly."""
        if old.get('lat') and new.get('lat'):
            if abs(old.get('lat', 0) - new.get('lat', 0)) > 0.001:
                return True
            if abs(old.get('lon', 0) - new.get('lon', 0)) > 0.001:
                return True

        old_alt = old.get('alt_baro') if isinstance(old.get('alt_baro'), int) else 0
        new_alt = new.get('alt_baro') if isinstance(new.get('alt_baro'), int) else 0
        if abs(old_alt - new_alt) > 100:
            return True

        if old.get('track') is not None and new.get('track') is not None:
            track_diff = abs(old.get('track', 0) - new.get('track', 0))
            track_diff = min(track_diff, 360 - track_diff)
            if track_diff > 5:
                return True

        if old.get('squawk') != new.get('squawk'):
            return True

        return False

    def _simplify_aircraft(self, ac: dict) -> dict:
        """Simplify aircraft data for transmission."""
        # Calculate distance from feeder if position is valid
        lat, lon = ac.get('lat'), ac.get('lon')
        distance_nm = None
        if is_valid_position(lat, lon):
            distance_nm = round(
                calculate_distance_nm(settings.feeder_lat, settings.feeder_lon, lat, lon),
                1
            )

        return {
            'hex': ac.get('hex'),
            'flight': (ac.get('flight') or '').strip(),
            'lat': lat,
            'lon': lon,
            'alt': ac.get('alt_baro'),
            'gs': ac.get('gs'),
            'track': ac.get('track'),
            'vr': ac.get('baro_rate'),
            'squawk': ac.get('squawk'),
            'category': ac.get('category'),
            'type': ac.get('t'),
            'rssi': ac.get('rssi'),
            'distance_nm': distance_nm,
            'military': bool(ac.get('dbFlags', 0) & 1),
            'emergency': ac.get('squawk') in ['7500', '7600', '7700'],
        }

    async def publish_airspace_update(self, advisories: list[dict], boundaries: list[dict]):
        """Publish airspace data update."""
        self._last_airspace_state = {
            'advisories': advisories,
            'boundaries': boundaries,
            'advisory_count': len(advisories),
            'boundary_count': len(boundaries),
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

        await self.broadcast_to_room('airspace', 'airspace:update', self._last_airspace_state)

    async def publish_advisory_update(self, advisories: list[dict]):
        """Publish advisory-only update."""
        timestamp = datetime.utcnow().isoformat() + 'Z'

        if 'advisories' in self._last_airspace_state:
            self._last_airspace_state['advisories'] = advisories
            self._last_airspace_state['advisory_count'] = len(advisories)
            self._last_airspace_state['timestamp'] = timestamp

        await self.broadcast_to_room('airspace', 'airspace:advisory', {
            'advisories': advisories,
            'count': len(advisories),
            'timestamp': timestamp
        })

    async def publish_boundary_update(self, boundaries: list[dict]):
        """Publish boundary-only update."""
        timestamp = datetime.utcnow().isoformat() + 'Z'

        if 'boundaries' in self._last_airspace_state:
            self._last_airspace_state['boundaries'] = boundaries
            self._last_airspace_state['boundary_count'] = len(boundaries)
            self._last_airspace_state['timestamp'] = timestamp

        await self.broadcast_to_room('airspace', 'airspace:boundary', {
            'boundaries': boundaries,
            'count': len(boundaries),
            'timestamp': timestamp
        })

    async def publish_safety_event(self, event: dict):
        """Publish safety event."""
        await self.broadcast_to_room('safety', 'safety:event', {
            'id': event.get('id'),  # Event ID for acknowledgment
            'event_type': event['event_type'],
            'severity': event['severity'],
            'icao': event['icao'],
            'icao_2': event.get('icao_2'),
            'callsign': event.get('callsign'),
            'callsign_2': event.get('callsign_2'),
            'message': event['message'],
            'details': event.get('details', {}),
            'aircraft_snapshot': event.get('aircraft_snapshot'),
            'aircraft_snapshot_2': event.get('aircraft_snapshot_2'),
            'acknowledged': event.get('acknowledged', False),
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

    async def publish_alert_triggered(
        self, rule_id: int, rule_name: str, icao: str,
        callsign: str, message: str, priority: str, aircraft_data: dict
    ):
        """Publish alert triggered event."""
        await self.broadcast_to_room('alerts', 'alert:triggered', {
            'rule_id': rule_id,
            'rule_name': rule_name,
            'icao': icao,
            'callsign': callsign,
            'message': message,
            'priority': priority,
            'aircraft_data': aircraft_data,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

    async def publish_acars_message(self, msg: dict):
        """Publish ACARS message with enriched data (airline, decoded text, etc.)."""
        await self.broadcast_to_room('acars', 'acars:message', {
            'source': msg.get('source', 'acars'),
            'icao_hex': msg.get('icao_hex'),
            'registration': msg.get('registration'),
            'callsign': msg.get('callsign'),
            'label': msg.get('label'),
            'text': msg.get('text'),
            'frequency': msg.get('frequency'),
            'signal_level': msg.get('signal_level'),
            # Enriched fields from ACARS decoder
            'airline': msg.get('airline'),
            'label_info': msg.get('label_info'),
            'decoded_text': msg.get('decoded_text'),
            'formatted_text': msg.get('formatted_text'),
            'timestamp': msg.get('timestamp') or datetime.utcnow().isoformat() + 'Z'
        })

    async def publish_audio_transmission(self, transmission: dict):
        """Publish new audio transmission event."""
        await self.broadcast_to_room('audio', 'audio:transmission', {
            'id': transmission.get('id'),
            'filename': transmission.get('filename'),
            's3_url': transmission.get('s3_url'),
            'frequency_mhz': transmission.get('frequency_mhz'),
            'channel_name': transmission.get('channel_name'),
            'duration_seconds': transmission.get('duration_seconds'),
            'file_size_bytes': transmission.get('file_size_bytes'),
            'format': transmission.get('format'),
            'squelch_level': transmission.get('squelch_level'),
            'transcription_status': transmission.get('transcription_status'),
            'transcript': transmission.get('transcript'),
            'transcript_confidence': transmission.get('transcript_confidence'),
            'transcript_language': transmission.get('transcript_language'),
            'transcription_error': transmission.get('transcription_error'),
            'created_at': transmission.get('created_at') or datetime.utcnow().isoformat() + 'Z',
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

    async def publish_airframe_error(
        self,
        icao_hex: str,
        error_type: str,
        error_message: str,
        source: str,
        details: Optional[dict] = None
    ):
        """
        Publish airframe lookup error event.

        Args:
            icao_hex: Aircraft ICAO hex code
            error_type: Type of error (e.g., "timeout", "api_error", "not_found")
            error_message: Human-readable error message
            source: Data source that failed (e.g., "hexdb", "opensky", "planespotters")
            details: Additional error details
        """
        await self.broadcast_to_room('aircraft', 'airframe:error', {
            'icao_hex': icao_hex,
            'error_type': error_type,
            'error_message': error_message,
            'source': source,
            'details': details or {},
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        })

    # =========================================================================
    # Status Methods
    # =========================================================================

    def is_using_redis(self) -> bool:
        """Check if using Redis."""
        return self._using_redis

    def get_connection_count(self) -> int:
        """Get current connection count."""
        return self._connection_count

    def get_last_publish_time(self) -> Optional[str]:
        """Get ISO timestamp of last publish."""
        if self._last_publish_time:
            return datetime.utcfromtimestamp(self._last_publish_time).isoformat() + 'Z'
        return None


# Global Socket.IO manager instance - created eagerly for app mounting
_sio_manager: Optional[SocketIOManager] = None


def create_socketio_manager() -> SocketIOManager:
    """Create the Socket.IO manager (idempotent - returns existing if already created)."""
    global _sio_manager
    if _sio_manager is None:
        _sio_manager = SocketIOManager()
    return _sio_manager


def get_socketio_manager() -> Optional[SocketIOManager]:
    """Get the global Socket.IO manager instance."""
    return _sio_manager


def get_socketio_app():
    """
    Get the Socket.IO ASGI app for mounting.
    Creates the manager if not already created.
    """
    manager = create_socketio_manager()
    return manager.app
