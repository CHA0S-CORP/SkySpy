"""
Cannonball Mode WebSocket consumer.

Provides real-time threat detection for mobile devices with:
- Position updates from device GPS
- Filtered threat list with distance calculations
- Trend detection (approaching/departing)
- Threat level classification
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

from channels.db import database_sync_to_async
from asgiref.sync import sync_to_async
from django.core.cache import cache

from skyspy.channels.consumers.base import BaseConsumer
from skyspy.services.law_enforcement_db import (
    identify_law_enforcement,
    get_threat_level,
    haversine_distance,
    calculate_bearing,
    get_direction_name,
)

logger = logging.getLogger(__name__)

# Cache settings
POSITION_CACHE_PREFIX = 'cannonball_pos:'
POSITION_CACHE_TTL = 60  # seconds


class CannonballConsumer(BaseConsumer):
    """
    WebSocket consumer optimized for mobile threat detection.

    Supports:
    - Position updates from mobile device
    - Filtered threat broadcasts
    - Request/response for on-demand threat queries
    """

    group_name_prefix = 'cannonball'
    supported_topics = ['threats', 'all']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.session_id = None
        self.user_position = None
        self.previous_position = None
        self.user_heading = None
        self.threat_radius_nm = 25.0

    async def connect(self):
        """Handle WebSocket connection."""
        await super().connect()

        # Generate session ID
        import uuid
        self.session_id = str(uuid.uuid4())

        # Send session info
        await self.send_json({
            'type': 'session_started',
            'session_id': self.session_id,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        # Clean up cached position
        if self.session_id:
            cache_key = f'{POSITION_CACHE_PREFIX}{self.session_id}'
            await sync_to_async(cache.delete)(cache_key)

        await super().disconnect(close_code)

    async def receive_json(self, content):
        """Handle incoming JSON messages."""
        msg_type = content.get('type')

        if msg_type == 'position_update':
            await self.handle_position_update(content)
        elif msg_type == 'set_radius':
            self.threat_radius_nm = float(content.get('radius_nm', 25.0))
            await self.send_json({
                'type': 'radius_updated',
                'radius_nm': self.threat_radius_nm,
            })
        elif msg_type == 'get_threats':
            await self.handle_get_threats()
        else:
            await super().receive_json(content)

    async def handle_position_update(self, content):
        """
        Handle position update from mobile device.

        Expected content:
        {
            "type": "position_update",
            "lat": 34.05,
            "lon": -118.25,
            "heading": 180,  // optional
            "accuracy": 10   // optional, in meters
        }
        """
        lat = content.get('lat')
        lon = content.get('lon')
        heading = content.get('heading')

        if lat is None or lon is None:
            await self.send_json({
                'type': 'error',
                'message': 'lat and lon are required',
            })
            return

        try:
            lat = float(lat)
            lon = float(lon)
        except (ValueError, TypeError):
            await self.send_json({
                'type': 'error',
                'message': 'Invalid coordinate values',
            })
            return

        # Store previous position for trend calculation
        self.previous_position = self.user_position

        # Update current position
        self.user_position = {'lat': lat, 'lon': lon}
        if heading is not None:
            self.user_heading = float(heading)

        # Cache position
        cache_key = f'{POSITION_CACHE_PREFIX}{self.session_id}'
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
        threats = await self.get_threats(lat, lon)
        await self.send_json({
            'type': 'threats',
            'data': threats,
            'count': len(threats),
            'position': {'lat': lat, 'lon': lon},
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    async def handle_get_threats(self):
        """Handle request for current threats without position update."""
        if not self.user_position:
            await self.send_json({
                'type': 'error',
                'message': 'No position set. Send position_update first.',
            })
            return

        threats = await self.get_threats(
            self.user_position['lat'],
            self.user_position['lon']
        )

        await self.send_json({
            'type': 'threats',
            'data': threats,
            'count': len(threats),
            'position': self.user_position,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    @sync_to_async
    def get_threats(self, user_lat: float, user_lon: float) -> List[Dict[str, Any]]:
        """
        Get nearby threats based on user position (cache-only, no DB).

        Args:
            user_lat: User latitude
            user_lon: User longitude

        Returns:
            List of threat dictionaries sorted by distance
        """
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
            if distance_nm > self.threat_radius_nm:
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
            if self.user_heading is not None:
                relative_bearing = (bearing - self.user_heading + 360) % 360

            # Calculate trend (approaching/departing)
            trend = self._calculate_trend(distance_nm, ac_lat, ac_lon)

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
    ) -> str:
        """Calculate if aircraft is approaching or departing."""
        if not self.previous_position:
            return 'unknown'

        prev_distance = haversine_distance(
            self.previous_position['lat'],
            self.previous_position['lon'],
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

    async def handle_request(self, request_type: str, request_id: str, params: dict):
        """Handle request/response pattern messages."""
        if request_type == 'threats':
            if self.user_position:
                threats = await self.get_threats(
                    self.user_position['lat'],
                    self.user_position['lon']
                )
            else:
                threats = []

            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'threats',
                'data': {
                    'threats': threats,
                    'count': len(threats),
                    'position': self.user_position,
                },
            })

        elif request_type == 'session-info':
            await self.send_json({
                'type': 'response',
                'request_id': request_id,
                'request_type': 'session-info',
                'data': {
                    'session_id': self.session_id,
                    'position': self.user_position,
                    'heading': self.user_heading,
                    'radius_nm': self.threat_radius_nm,
                },
            })

        else:
            await super().handle_request(request_type, request_id, params)

    # Group message handlers for broadcasts
    async def threat_update(self, event):
        """Handle threat update broadcast."""
        # Only send if we have a position
        if not self.user_position:
            return

        # Re-filter threats based on our position
        threats = await self.get_threats(
            self.user_position['lat'],
            self.user_position['lon']
        )

        await self.send_json({
            'type': 'threats',
            'data': threats,
            'count': len(threats),
            'position': self.user_position,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })
