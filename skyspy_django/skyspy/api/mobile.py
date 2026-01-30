"""
Mobile position API for Cannonball mode.

Provides endpoints for:
- Receiving GPS position updates from mobile devices
- Returning nearby threats with distance calculations
- Managing mobile session state
"""
import logging
import uuid
from datetime import datetime
from typing import List, Dict, Any

from django.core.cache import cache
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from skyspy.services.law_enforcement_db import (
    identify_law_enforcement,
    get_threat_level,
    haversine_distance,
    calculate_bearing,
    get_direction_name,
)
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.auth.permissions import FeatureBasedPermission

logger = logging.getLogger(__name__)

# Cache key prefixes
MOBILE_POSITION_PREFIX = 'mobile_pos:'
MOBILE_HISTORY_PREFIX = 'mobile_history:'

# Default thresholds
DEFAULT_THREAT_RADIUS_NM = 25  # Nautical miles
POSITION_TTL_SECONDS = 30
HISTORY_TTL_SECONDS = 3600  # 1 hour


class MobileViewSet(ViewSet):
    """
    Mobile position and threat detection API.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    @action(detail=False, methods=['POST'], url_path='position')
    def update_position(self, request):
        """
        Update mobile device position and return nearby threats.

        Request body:
        {
            "lat": 34.05,
            "lon": -118.25,
            "session_id": "optional-session-id",
            "heading": 180,  // optional device heading
            "radius_nm": 25  // optional threat radius
        }

        Returns:
        {
            "session_id": "generated-or-provided-session-id",
            "position": {"lat": 34.05, "lon": -118.25},
            "threats": [...],
            "timestamp": "2024-01-01T00:00:00Z"
        }
        """
        lat = request.data.get('lat')
        lon = request.data.get('lon')
        session_id = request.data.get('session_id')
        heading = request.data.get('heading')
        radius_nm = request.data.get('radius_nm', DEFAULT_THREAT_RADIUS_NM)

        # Validate coordinates
        if lat is None or lon is None:
            return Response(
                {'error': 'lat and lon are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            lat = float(lat)
            lon = float(lon)
            radius_nm = float(radius_nm)
        except (ValueError, TypeError):
            return Response(
                {'error': 'Invalid coordinate values'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return Response(
                {'error': 'Coordinates out of range'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Generate session ID if not provided
        if not session_id:
            session_id = str(uuid.uuid4())

        # Get previous position for trend calculation
        cache_key = f'{MOBILE_POSITION_PREFIX}{session_id}'
        previous_data = cache.get(cache_key)

        # Store current position in cache
        position_data = {
            'lat': lat,
            'lon': lon,
            'heading': heading,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }
        cache.set(cache_key, position_data, POSITION_TTL_SECONDS)

        # Calculate threats
        threats = self._get_nearby_threats(lat, lon, radius_nm, heading, previous_data)

        return Response({
            'session_id': session_id,
            'position': {'lat': lat, 'lon': lon},
            'threats': threats,
            'threat_count': len(threats),
            'timestamp': position_data['timestamp'],
        })

    @action(detail=False, methods=['GET'], url_path='threats')
    def get_threats(self, request):
        """
        Get threats for a stored session position.

        Query params:
        - session_id: Session ID from previous position update
        - radius_nm: Optional threat radius (default 25nm)

        Returns:
        {
            "threats": [...],
            "position": {"lat": 34.05, "lon": -118.25},
            "timestamp": "2024-01-01T00:00:00Z"
        }
        """
        session_id = request.query_params.get('session_id')
        radius_nm = float(request.query_params.get('radius_nm', DEFAULT_THREAT_RADIUS_NM))

        if not session_id:
            return Response(
                {'error': 'session_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get cached position
        cache_key = f'{MOBILE_POSITION_PREFIX}{session_id}'
        position_data = cache.get(cache_key)

        if not position_data:
            return Response(
                {'error': 'Session not found or expired'},
                status=status.HTTP_404_NOT_FOUND
            )

        lat = position_data['lat']
        lon = position_data['lon']
        heading = position_data.get('heading')

        threats = self._get_nearby_threats(lat, lon, radius_nm, heading)

        return Response({
            'threats': threats,
            'threat_count': len(threats),
            'position': {'lat': lat, 'lon': lon},
            'timestamp': position_data['timestamp'],
        })

    @action(detail=False, methods=['POST'], url_path='session/start')
    def start_session(self, request):
        """
        Start a new mobile tracking session.

        Request body:
        {
            "persistent": true  // Whether to save encounter history
        }

        Returns:
        {
            "session_id": "uuid",
            "persistent": true,
            "started_at": "2024-01-01T00:00:00Z"
        }
        """
        persistent = request.data.get('persistent', False)
        session_id = str(uuid.uuid4())
        started_at = datetime.utcnow().isoformat() + 'Z'

        # Store session metadata
        session_data = {
            'session_id': session_id,
            'persistent': persistent,
            'started_at': started_at,
            'encounters': [],
        }

        cache_key = f'{MOBILE_HISTORY_PREFIX}{session_id}'
        cache.set(cache_key, session_data, HISTORY_TTL_SECONDS)

        return Response({
            'session_id': session_id,
            'persistent': persistent,
            'started_at': started_at,
        })

    @action(detail=False, methods=['POST'], url_path='session/end')
    def end_session(self, request):
        """
        End a mobile tracking session.

        Request body:
        {
            "session_id": "uuid"
        }

        Returns:
        {
            "session_id": "uuid",
            "encounters": [...],
            "duration_seconds": 1234
        }
        """
        session_id = request.data.get('session_id')

        if not session_id:
            return Response(
                {'error': 'session_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get session data
        cache_key = f'{MOBILE_HISTORY_PREFIX}{session_id}'
        session_data = cache.get(cache_key)

        # Clean up position cache
        pos_key = f'{MOBILE_POSITION_PREFIX}{session_id}'
        cache.delete(pos_key)

        if not session_data:
            return Response({
                'session_id': session_id,
                'encounters': [],
                'duration_seconds': 0,
            })

        # Calculate duration
        started_at = datetime.fromisoformat(session_data['started_at'].replace('Z', '+00:00'))
        ended_at = datetime.utcnow().replace(tzinfo=started_at.tzinfo)
        duration_seconds = int((ended_at - started_at).total_seconds())

        # Delete session if not persistent
        if not session_data.get('persistent', False):
            cache.delete(cache_key)

        return Response({
            'session_id': session_id,
            'encounters': session_data.get('encounters', []),
            'duration_seconds': duration_seconds,
            'persistent': session_data.get('persistent', False),
        })

    @action(detail=False, methods=['GET'], url_path='session/history')
    def get_history(self, request):
        """
        Get encounter history for a persistent session.

        Query params:
        - session_id: Session ID

        Returns:
        {
            "session_id": "uuid",
            "encounters": [...],
            "started_at": "2024-01-01T00:00:00Z"
        }
        """
        session_id = request.query_params.get('session_id')

        if not session_id:
            return Response(
                {'error': 'session_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        cache_key = f'{MOBILE_HISTORY_PREFIX}{session_id}'
        session_data = cache.get(cache_key)

        if not session_data:
            return Response(
                {'error': 'Session not found or expired'},
                status=status.HTTP_404_NOT_FOUND
            )

        return Response({
            'session_id': session_id,
            'encounters': session_data.get('encounters', []),
            'started_at': session_data.get('started_at'),
            'persistent': session_data.get('persistent', False),
        })

    def _get_nearby_threats(
        self,
        user_lat: float,
        user_lon: float,
        radius_nm: float,
        user_heading: float = None,
        previous_data: dict = None,
    ) -> List[Dict[str, Any]]:
        """
        Get nearby threats based on user position.

        Args:
            user_lat: User latitude
            user_lon: User longitude
            radius_nm: Search radius in nautical miles
            user_heading: Optional user heading for relative bearing
            previous_data: Previous position data for trend calculation

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
            if distance_nm > radius_nm:
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
            trend = 'unknown'
            if previous_data:
                prev_lat = previous_data.get('lat')
                prev_lon = previous_data.get('lon')
                if prev_lat and prev_lon:
                    prev_distance = haversine_distance(prev_lat, prev_lon, ac_lat, ac_lon)
                    if distance_nm < prev_distance - 0.05:
                        trend = 'approaching'
                    elif distance_nm > prev_distance + 0.05:
                        trend = 'departing'
                    else:
                        trend = 'holding'

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
