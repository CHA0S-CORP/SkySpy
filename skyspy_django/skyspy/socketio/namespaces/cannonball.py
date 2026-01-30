"""
Cannonball Mode Socket.IO namespace for SkysPy.

Provides real-time threat detection for mobile devices with:
- Position updates from device GPS
- Filtered threat list with distance calculations
- Trend detection (approaching/departing)
- Threat level classification

Events:
- session_started - Emitted on connect with session ID
- threats - Threat list update
- radius_updated - Confirmation of radius change
- error - Error messages

Client events handled:
- position_update - Update device position
- set_radius - Set threat detection radius
- get_threats - Request current threats
- request - Request/response pattern
"""
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import socketio
from asgiref.sync import sync_to_async
from django.core.cache import cache

from skyspy.services.law_enforcement_db import (
    calculate_bearing,
    get_direction_name,
    get_threat_level,
    haversine_distance,
    identify_law_enforcement,
)
from skyspy.socketio.middleware import authenticate_socket, check_topic_permission
from skyspy.socketio.server import sio

logger = logging.getLogger(__name__)

# Cache settings
POSITION_CACHE_PREFIX = 'cannonball_pos:'
POSITION_CACHE_TTL = 60  # seconds


class CannonballNamespace(socketio.AsyncNamespace):
    """
    Socket.IO namespace optimized for mobile threat detection.

    Supports:
    - Position updates from mobile device
    - Filtered threat broadcasts
    - Request/response for on-demand threat queries

    Session data stored:
    - user: Authenticated user
    - session_id: Unique session identifier
    - position: Current user position {lat, lon}
    - previous_position: Previous position for trend calculation
    - heading: User's heading in degrees
    - threat_radius_nm: Threat detection radius in nautical miles
    """

    def __init__(self):
        super().__init__('/cannonball')
        self.supported_topics = ['threats', 'all']

    async def on_connect(self, sid, environ, auth=None):
        """
        Handle client connection.

        Authenticates the user, generates session ID, and sends session info.
        """
        # Authenticate the connection
        user, error = await authenticate_socket(auth)

        if error:
            from django.conf import settings as django_settings
            auth_mode = getattr(django_settings, 'AUTH_MODE', 'hybrid')
            reject_invalid = getattr(django_settings, 'WS_REJECT_INVALID_TOKENS', False)
            if auth_mode == 'private' or (auth_mode == 'hybrid' and reject_invalid):
                logger.warning(f"Cannonball namespace auth rejected for {sid}: {error}")
                return False
            logger.warning(f"Cannonball namespace auth error for {sid}: {error}")

        # Check permission (cannonball uses 'aircraft' permission as base)
        # In a real system, you might have a specific 'cannonball' permission
        if not await check_topic_permission(user, 'aircraft'):
            logger.warning(f"Cannonball namespace permission denied for {sid}")
            return False

        # Generate session ID
        session_id = str(uuid.uuid4())

        # Initialize session data
        await sio.save_session(sid, {
            'user': user,
            'auth_error': error,
            'session_id': session_id,
            'position': None,
            'previous_position': None,
            'heading': None,
            'threat_radius_nm': 25.0,
        }, namespace='/cannonball')

        logger.info(f"Client connected to /cannonball: {sid} (session: {session_id})")

        # Send session started event
        await self.emit('session_started', {
            'session_id': session_id,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }, room=sid)

        return True

    async def on_disconnect(self, sid):
        """Handle client disconnection and clean up cached position."""
        try:
            session = await sio.get_session(sid, namespace='/cannonball')
            session_id = session.get('session_id')

            if session_id:
                # Clean up cached position
                cache_key = f'{POSITION_CACHE_PREFIX}{session_id}'
                await sync_to_async(cache.delete)(cache_key)
                logger.debug(f"Cleaned up position cache for session {session_id}")

        except Exception as e:
            logger.debug(f"Error during disconnect cleanup: {e}")

        logger.info(f"Client disconnected from /cannonball: {sid}")

    async def on_position_update(self, sid, data):
        """
        Handle position update from mobile device.

        Expected data:
        {
            "lat": 34.05,
            "lon": -118.25,
            "heading": 180,  // optional
            "accuracy": 10   // optional, in meters
        }
        """
        lat = data.get('lat')
        lon = data.get('lon')
        heading = data.get('heading')

        if lat is None or lon is None:
            await self.emit('error', {
                'message': 'lat and lon are required',
            }, room=sid)
            return

        try:
            lat = float(lat)
            lon = float(lon)
        except (ValueError, TypeError):
            await self.emit('error', {
                'message': 'Invalid coordinate values',
            }, room=sid)
            return

        # Get current session
        session = await sio.get_session(sid, namespace='/cannonball')

        # Store previous position for trend calculation
        previous_position = session.get('position')

        # Update current position
        current_position = {'lat': lat, 'lon': lon}
        session['previous_position'] = previous_position
        session['position'] = current_position

        if heading is not None:
            session['heading'] = float(heading)

        # Save updated session
        await sio.save_session(sid, session, namespace='/cannonball')

        # Cache position
        session_id = session.get('session_id')
        if session_id:
            cache_key = f'{POSITION_CACHE_PREFIX}{session_id}'
            await sync_to_async(cache.set)(
                cache_key,
                {
                    'lat': lat,
                    'lon': lon,
                    'heading': heading,
                    'timestamp': datetime.utcnow().isoformat() + 'Z',
                },
                POSITION_CACHE_TTL
            )

        # Get and send threats
        threats = await self._get_threats(session)

        await self.emit('threats', {
            'data': threats,
            'count': len(threats),
            'position': {'lat': lat, 'lon': lon},
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }, room=sid)

    async def on_set_radius(self, sid, data):
        """
        Handle radius setting.

        Expected data:
        {"radius_nm": 25.0}
        """
        radius_nm = data.get('radius_nm', 25.0)

        try:
            radius_nm = float(radius_nm)
        except (ValueError, TypeError):
            await self.emit('error', {
                'message': 'Invalid radius value',
            }, room=sid)
            return

        # Clamp radius to reasonable bounds
        radius_nm = max(1.0, min(100.0, radius_nm))

        # Update session
        session = await sio.get_session(sid, namespace='/cannonball')
        session['threat_radius_nm'] = radius_nm
        await sio.save_session(sid, session, namespace='/cannonball')

        await self.emit('radius_updated', {
            'radius_nm': radius_nm,
        }, room=sid)

    async def on_get_threats(self, sid):
        """Handle request for current threats without position update."""
        session = await sio.get_session(sid, namespace='/cannonball')
        position = session.get('position')

        if not position:
            await self.emit('error', {
                'message': 'No position set. Send position_update first.',
            }, room=sid)
            return

        threats = await self._get_threats(session)

        await self.emit('threats', {
            'data': threats,
            'count': len(threats),
            'position': position,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }, room=sid)

    async def on_request(self, sid, data):
        """
        Handle request/response pattern messages.

        Expected data:
        {
            "type": "threats" | "session-info",
            "request_id": "unique-id",
            "params": {...}
        }
        """
        request_type = data.get('type')
        request_id = data.get('request_id')
        params = data.get('params', {})

        session = await sio.get_session(sid, namespace='/cannonball')

        if request_type == 'threats':
            position = session.get('position')
            if position:
                threats = await self._get_threats(session)
            else:
                threats = []

            await self.emit('response', {
                'request_id': request_id,
                'request_type': 'threats',
                'data': {
                    'threats': threats,
                    'count': len(threats),
                    'position': position,
                },
            }, room=sid)

        elif request_type == 'session-info':
            await self.emit('response', {
                'request_id': request_id,
                'request_type': 'session-info',
                'data': {
                    'session_id': session.get('session_id'),
                    'position': session.get('position'),
                    'heading': session.get('heading'),
                    'radius_nm': session.get('threat_radius_nm', 25.0),
                },
            }, room=sid)

        else:
            await self.emit('error', {
                'request_id': request_id,
                'message': f'Unknown request type: {request_type}',
            }, room=sid)

    @sync_to_async
    def _get_threats(self, session: dict) -> List[Dict[str, Any]]:
        """
        Get nearby threats based on user position (cache-only, no DB).

        Args:
            session: Session dictionary containing position, heading, radius

        Returns:
            List of threat dictionaries sorted by distance
        """
        position = session.get('position')
        if not position:
            return []

        user_lat = position['lat']
        user_lon = position['lon']
        user_heading = session.get('heading')
        previous_position = session.get('previous_position')
        threat_radius_nm = session.get('threat_radius_nm', 25.0)

        # Get current aircraft from cache
        aircraft_list = cache.get('current_aircraft', [])
        threats = []

        for aircraft in aircraft_list:
            ac_lat = aircraft.get('lat')
            ac_lon = aircraft.get('lon')

            if ac_lat is None or ac_lon is None:
                continue

            # Calculate distance
            distance_nm = haversine_distance(user_lat, user_lon, ac_lat, ac_lon)

            # Skip if outside radius
            if distance_nm > threat_radius_nm:
                continue

            # Identify law enforcement / helicopter
            le_info = identify_law_enforcement(
                hex_code=aircraft.get('hex'),
                callsign=aircraft.get('flight') or aircraft.get('callsign'),
                operator=aircraft.get('ownOp') or aircraft.get('operator'),
                category=aircraft.get('category'),
                type_code=aircraft.get('t') or aircraft.get('type'),
            )

            # Only include if it's a threat (law enforcement, helicopter, or surveillance type)
            if not le_info['is_interest']:
                continue

            # Calculate bearing
            bearing = calculate_bearing(user_lat, user_lon, ac_lat, ac_lon)

            # Calculate relative bearing if user heading is known
            relative_bearing = None
            if user_heading is not None:
                relative_bearing = (bearing - user_heading + 360) % 360

            # Calculate trend (approaching/departing)
            trend = self._calculate_trend(
                distance_nm,
                ac_lat,
                ac_lon,
                previous_position
            )

            # Get threat level
            threat_level = get_threat_level(aircraft, distance_nm, le_info)

            # Build threat object
            threat = {
                'hex': aircraft.get('hex'),
                'callsign': (aircraft.get('flight') or '').strip() or None,
                'category': le_info.get('category') or ('Helicopter' if le_info['is_helicopter'] else 'Aircraft'),
                'description': le_info.get('description'),
                'distance_nm': round(distance_nm, 2),
                'bearing': round(bearing, 1),
                'relative_bearing': round(relative_bearing, 1) if relative_bearing is not None else None,
                'direction': get_direction_name(bearing),
                'altitude': aircraft.get('alt_baro') or aircraft.get('alt_geom') or aircraft.get('alt'),
                'ground_speed': aircraft.get('gs'),
                'vertical_rate': aircraft.get('baro_rate') or aircraft.get('geom_rate'),
                'trend': trend,
                'threat_level': threat_level,
                'is_law_enforcement': le_info['is_law_enforcement'],
                'is_helicopter': le_info['is_helicopter'],
                'confidence': le_info.get('confidence', 'unknown'),
                'aircraft_type': aircraft.get('t') or aircraft.get('type'),
                'registration': aircraft.get('r'),
                'lat': ac_lat,
                'lon': ac_lon,
            }

            threats.append(threat)

        # Sort by distance (closest first), then by threat level
        threat_order = {'critical': 0, 'warning': 1, 'info': 2}
        threats.sort(key=lambda x: (threat_order.get(x['threat_level'], 3), x['distance_nm']))

        return threats

    def _calculate_trend(
        self,
        current_distance: float,
        ac_lat: float,
        ac_lon: float,
        previous_position: Optional[Dict[str, float]],
    ) -> str:
        """Calculate if aircraft is approaching or departing."""
        if not previous_position:
            return 'unknown'

        prev_distance = haversine_distance(
            previous_position['lat'],
            previous_position['lon'],
            ac_lat,
            ac_lon
        )

        diff = current_distance - prev_distance
        if diff < -0.05:  # Getting closer by more than 0.05nm
            return 'approaching'
        elif diff > 0.05:  # Getting farther by more than 0.05nm
            return 'departing'
        else:
            return 'holding'


# Create and register the namespace
cannonball_namespace = CannonballNamespace()


def register_cannonball_namespace():
    """Register the cannonball namespace with the Socket.IO server."""
    sio.register_namespace(cannonball_namespace)
    logger.info("Registered CannonballNamespace at /cannonball")


# Broadcast helper function for use by other parts of the application

async def broadcast_threat_update():
    """
    Broadcast threat update to all connected cannonball clients.

    This triggers each client to refresh their threat list based on
    their current position.
    """
    # Get all connected sessions in this namespace
    # Note: This is a simplified broadcast - in production you might
    # want to iterate through sessions and send personalized updates
    await sio.emit('threat_refresh', {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }, namespace='/cannonball')
