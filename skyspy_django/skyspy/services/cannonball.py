"""
Cannonball Mode - Advanced law enforcement and traffic enforcement detection.

This service provides pattern-based detection for:
- Law enforcement aircraft (extends law_enforcement_db.py)
- Traffic enforcement patterns (circling over highways, speed traps)
- Surveillance patterns (orbiting, loitering, grid search)
- Behavioral analysis for potential enforcement activity

Designed to integrate with the frontend Cannonball Mode for driver awareness.
"""
import logging
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple, Set
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .law_enforcement_db import (
    identify_law_enforcement,
    get_threat_level,
    haversine_distance,
    calculate_bearing,
    get_direction_name,
    get_trend,
)

logger = logging.getLogger(__name__)

# Cache keys
CACHE_POSITION_HISTORY = 'cannonball:positions:{}'
CACHE_PATTERN_DETECTIONS = 'cannonball:patterns:{}'
CACHE_ACTIVE_THREATS = 'cannonball:threats'
CACHE_HIGHWAY_WATCHERS = 'cannonball:highway_watchers'

# Configuration
POSITION_HISTORY_LENGTH = 30  # Number of positions to track per aircraft
POSITION_HISTORY_TTL = 600  # 10 minutes TTL for position history
CIRCLING_MIN_POSITIONS = 8  # Minimum positions to detect circling
CIRCLING_RADIUS_THRESHOLD = 2.0  # nm - max radius for circling pattern
LOITERING_TIME_THRESHOLD = 10  # minutes to consider loitering
GRID_PATTERN_THRESHOLD = 0.3  # Coefficient threshold for grid pattern
CLOSING_SPEED_ALERT_THRESHOLD = 100  # knots


@dataclass
class AircraftPosition:
    """Single position report for pattern analysis."""
    lat: float
    lon: float
    altitude: Optional[int]
    speed: Optional[float]
    track: Optional[float]
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            'lat': self.lat,
            'lon': self.lon,
            'altitude': self.altitude,
            'speed': self.speed,
            'track': self.track,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AircraftPosition':
        return cls(
            lat=data['lat'],
            lon=data['lon'],
            altitude=data.get('altitude'),
            speed=data.get('speed'),
            track=data.get('track'),
            timestamp=datetime.fromisoformat(data['timestamp']) if data.get('timestamp') else timezone.now(),
        )


@dataclass
class PatternDetection:
    """Detected flight pattern."""
    pattern_type: str  # 'circling', 'loitering', 'grid_search', 'speed_trap', 'highway_patrol'
    confidence: float  # 0-1
    center_lat: Optional[float] = None
    center_lon: Optional[float] = None
    radius_nm: Optional[float] = None
    duration_minutes: Optional[int] = None
    description: str = ''
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'pattern_type': self.pattern_type,
            'confidence': self.confidence,
            'center_lat': self.center_lat,
            'center_lon': self.center_lon,
            'radius_nm': self.radius_nm,
            'duration_minutes': self.duration_minutes,
            'description': self.description,
            'metadata': self.metadata,
        }


@dataclass
class CannonballThreat:
    """Enhanced threat information for Cannonball Mode."""
    hex: str
    callsign: Optional[str]
    category: str
    description: str
    distance_nm: float
    bearing: float
    direction: str
    altitude: Optional[int]
    ground_speed: Optional[float]
    track: Optional[float]
    vertical_rate: Optional[int]
    trend: str
    threat_level: str
    is_law_enforcement: bool
    is_helicopter: bool
    is_surveillance_type: bool
    confidence: str
    urgency_score: int
    closing_speed: Optional[float] = None
    eta_seconds: Optional[int] = None
    patterns: List[PatternDetection] = field(default_factory=list)
    lat: float = 0.0
    lon: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'hex': self.hex,
            'callsign': self.callsign,
            'category': self.category,
            'description': self.description,
            'distance_nm': self.distance_nm,
            'bearing': self.bearing,
            'direction': self.direction,
            'altitude': self.altitude,
            'ground_speed': self.ground_speed,
            'track': self.track,
            'vertical_rate': self.vertical_rate,
            'trend': self.trend,
            'threat_level': self.threat_level,
            'is_law_enforcement': self.is_law_enforcement,
            'is_helicopter': self.is_helicopter,
            'is_surveillance_type': self.is_surveillance_type,
            'confidence': self.confidence,
            'urgency_score': self.urgency_score,
            'closing_speed': self.closing_speed,
            'eta_seconds': self.eta_seconds,
            'patterns': [p.to_dict() for p in self.patterns],
            'lat': self.lat,
            'lon': self.lon,
        }


# Additional callsign patterns for traffic enforcement
TRAFFIC_ENFORCEMENT_PATTERNS: List[Tuple[str, str, str]] = [
    # Traffic helicopters
    (r'^TRAFF\d*', 'Traffic Enforcement', 'Traffic Helicopter'),
    (r'^SPEED\d*', 'Traffic Enforcement', 'Speed Enforcement'),
    (r'^MOTOR\d*', 'Traffic Enforcement', 'Motor Patrol'),
    (r'^AIRWATCH\d*', 'Traffic Enforcement', 'Air Watch Traffic'),
    (r'^EYE\d*', 'Traffic Enforcement', 'Eye in the Sky'),

    # Highway patrol specific
    (r'^HIGHWAY\d*', 'Highway Patrol', 'Highway Patrol'),
    (r'^HWAY\d*', 'Highway Patrol', 'Highway Patrol'),
    (r'^FREEWAY\d*', 'Highway Patrol', 'Freeway Patrol'),
    (r'^I\d{1,3}PAT', 'Highway Patrol', 'Interstate Patrol'),

    # More state patrol callsigns
    (r'^ASP\d*', 'State Police', 'Arizona State Patrol'),
    (r'^CSP\d*', 'State Police', 'Colorado State Patrol'),
    (r'^GSP\d*', 'State Police', 'Georgia State Patrol'),
    (r'^KHP\d*', 'State Police', 'Kansas Highway Patrol'),
    (r'^LSP\d*', 'State Police', 'Louisiana State Police'),
    (r'^NHP\d*', 'State Police', 'Nevada Highway Patrol'),
    (r'^NCSHP\d*', 'State Police', 'North Carolina State Highway Patrol'),
    (r'^UHP\d*', 'State Police', 'Utah Highway Patrol'),
    (r'^VHP\d*', 'State Police', 'Virginia Highway Patrol'),

    # County sheriffs air units
    (r'^LASO\d*', 'Sheriff Aviation', 'Los Angeles County Sheriff'),
    (r'^OCSD\d*', 'Sheriff Aviation', 'Orange County Sheriff'),
    (r'^SDSO\d*', 'Sheriff Aviation', 'San Diego County Sheriff'),
    (r'^HCSO\d*', 'Sheriff Aviation', 'Harris County Sheriff'),
    (r'^PBSO\d*', 'Sheriff Aviation', 'Palm Beach Sheriff'),
    (r'^BSO\d*', 'Sheriff Aviation', 'Broward Sheriff'),
    (r'^CCSO\d*', 'Sheriff Aviation', 'County Sheriff Office'),
    (r'^WCSO\d*', 'Sheriff Aviation', 'County Sheriff Office'),

    # Additional federal patterns
    (r'^CONUS\d*', 'Federal Law Enforcement', 'CONUS Operations'),
    (r'^FEDEX\d*', 'Federal Law Enforcement', 'Federal Excercise'),  # Be careful - might match FedEx
    (r'^JSTARS\d*', 'Federal Law Enforcement', 'Joint STARS'),

    # Fire/emergency (often work with LE)
    (r'^TANKER\d*', 'Fire/Emergency', 'Air Tanker'),
    (r'^FIRE\d*', 'Fire/Emergency', 'Fire Response'),
    (r'^CALFIRE\d*', 'Fire/Emergency', 'CAL FIRE'),
]

# Additional operator ICAO codes
ADDITIONAL_LE_OPERATORS: Dict[str, Tuple[str, str]] = {
    # More federal agencies
    'TSA': ('Federal Law Enforcement', 'Transportation Security Administration'),
    'NSA': ('Federal Law Enforcement', 'National Security Agency'),
    'CIA': ('Federal Law Enforcement', 'Central Intelligence Agency'),
    'USCG': ('Federal Law Enforcement', 'US Coast Guard'),
    'USSS': ('Federal Law Enforcement', 'US Secret Service'),

    # Military (often used for LE support)
    'NG': ('National Guard', 'National Guard'),
    'ANG': ('National Guard', 'Air National Guard'),
    'USAF': ('Military', 'US Air Force'),
    'USA': ('Military', 'US Army'),
    'USN': ('Military', 'US Navy'),

    # State police aviation
    'TXSP': ('State Police', 'Texas State Police'),
    'CASP': ('State Police', 'California State Police'),
    'FLHP': ('State Police', 'Florida Highway Patrol'),
    'GAHP': ('State Police', 'Georgia Highway Patrol'),

    # County/city LE
    'PBCSO': ('Sheriff Aviation', 'Palm Beach County Sheriff'),
    'SDPD': ('Police Aviation', 'San Diego Police Dept'),
    'PPD': ('Police Aviation', 'Phoenix Police Dept'),
    'DPD': ('Police Aviation', 'Dallas Police Dept'),
    'APD': ('Police Aviation', 'Austin Police Dept'),
    'SPD': ('Police Aviation', 'Seattle Police Dept'),
    'OPD': ('Police Aviation', 'Oakland Police Dept'),
    'SFO': ('Police Aviation', 'San Francisco Police Dept'),
}


class CannonballService:
    """
    Service for Cannonball Mode threat detection and pattern analysis.

    Provides:
    - Enhanced law enforcement detection
    - Pattern-based behavior analysis
    - Urgency scoring
    - Closing speed and ETA calculations
    """

    def __init__(self):
        self._position_history: Dict[str, List[AircraftPosition]] = {}
        self._pattern_cache: Dict[str, List[PatternDetection]] = {}
        self._previous_distances: Dict[str, float] = {}

    def analyze_aircraft(
        self,
        aircraft_list: List[Dict[str, Any]],
        user_lat: float,
        user_lon: float,
        user_heading: Optional[float] = None,
        radius_nm: float = 25.0,
        altitude_ceiling: int = 20000,
    ) -> List[CannonballThreat]:
        """
        Analyze aircraft for Cannonball Mode threats.

        Args:
            aircraft_list: List of aircraft data dictionaries
            user_lat: User latitude
            user_lon: User longitude
            user_heading: User heading (for relative bearing)
            radius_nm: Maximum radius to consider
            altitude_ceiling: Ignore aircraft above this altitude

        Returns:
            List of CannonballThreat objects sorted by urgency
        """
        threats: List[CannonballThreat] = []

        for ac in aircraft_list:
            if not ac.get('lat') or not ac.get('lon'):
                continue

            # Calculate distance
            ac_lat = ac['lat']
            ac_lon = ac['lon']
            distance_nm = haversine_distance(user_lat, user_lon, ac_lat, ac_lon)

            # Apply radius filter
            if distance_nm > radius_nm:
                continue

            # Apply altitude filter
            altitude = ac.get('alt_baro') or ac.get('alt_geom') or ac.get('altitude') or 0
            if altitude > altitude_ceiling:
                continue

            # Get hex identifier
            hex_code = ac.get('hex', '')
            if not hex_code:
                continue

            # Identify law enforcement characteristics
            le_info = self._enhanced_identify_le(ac)

            # Skip if not interesting
            if not le_info['is_interest']:
                continue

            # Calculate bearing
            bearing = calculate_bearing(user_lat, user_lon, ac_lat, ac_lon)

            # Get trend and closing speed
            prev_distance = self._previous_distances.get(hex_code)
            trend = get_trend(distance_nm, prev_distance)
            closing_speed = self._calculate_closing_speed(hex_code, distance_nm, prev_distance)

            # Calculate ETA if approaching
            eta_seconds = None
            if closing_speed and closing_speed > 0 and trend == 'approaching':
                eta_hours = distance_nm / closing_speed
                eta_seconds = int(eta_hours * 3600)
                if eta_seconds > 1800:  # Cap at 30 minutes
                    eta_seconds = None

            # Store position for pattern analysis
            self._store_position(hex_code, ac)

            # Detect patterns
            patterns = self._detect_patterns(hex_code)

            # Get threat level
            threat_level = get_threat_level(ac, distance_nm, le_info)

            # Calculate urgency score
            urgency_score = self._calculate_urgency(
                distance_nm=distance_nm,
                threat_level=threat_level,
                le_info=le_info,
                trend=trend,
                closing_speed=closing_speed,
                eta_seconds=eta_seconds,
                patterns=patterns,
            )

            # Create threat object
            threat = CannonballThreat(
                hex=hex_code,
                callsign=(ac.get('flight') or ac.get('callsign') or '').strip() or None,
                category=le_info.get('category') or 'Unknown',
                description=le_info.get('description') or '',
                distance_nm=round(distance_nm, 2),
                bearing=round(bearing, 1),
                direction=get_direction_name(bearing),
                altitude=altitude,
                ground_speed=ac.get('gs'),
                track=ac.get('track'),
                vertical_rate=ac.get('baro_rate') or ac.get('geom_rate'),
                trend=trend,
                threat_level=threat_level,
                is_law_enforcement=le_info['is_law_enforcement'],
                is_helicopter=le_info['is_helicopter'],
                is_surveillance_type=le_info['is_surveillance_type'],
                confidence=le_info['confidence'],
                urgency_score=urgency_score,
                closing_speed=closing_speed,
                eta_seconds=eta_seconds,
                patterns=patterns,
                lat=ac_lat,
                lon=ac_lon,
            )

            threats.append(threat)

            # Update previous distance
            self._previous_distances[hex_code] = distance_nm

        # Sort by urgency score (descending), then threat level, then distance
        threat_order = {'critical': 0, 'warning': 1, 'info': 2}
        threats.sort(key=lambda t: (-t.urgency_score, threat_order.get(t.threat_level, 3), t.distance_nm))

        return threats

    def _enhanced_identify_le(self, aircraft: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enhanced law enforcement identification with additional patterns.
        """
        import re

        # Start with base identification
        result = identify_law_enforcement(
            hex_code=aircraft.get('hex'),
            callsign=aircraft.get('flight') or aircraft.get('callsign'),
            operator=aircraft.get('ownOp') or aircraft.get('operator'),
            registration=aircraft.get('r') or aircraft.get('registration'),
            category=aircraft.get('category'),
            type_code=aircraft.get('t') or aircraft.get('type'),
        )

        # Check additional traffic enforcement patterns
        callsign = (aircraft.get('flight') or aircraft.get('callsign') or '').strip().upper()
        if callsign:
            for pattern, category, description in TRAFFIC_ENFORCEMENT_PATTERNS:
                if re.match(pattern, callsign, re.IGNORECASE):
                    result['is_law_enforcement'] = category not in ['Fire/Emergency']
                    result['is_interest'] = True
                    if result['confidence'] == 'none':
                        result['confidence'] = 'high'
                    if not result['category']:
                        result['category'] = category
                        result['description'] = description
                    result['identifiers'].append('traffic_pattern')
                    break

        # Check additional operator codes
        operator = (aircraft.get('ownOp') or aircraft.get('operator') or '').strip().upper()
        if operator and operator in ADDITIONAL_LE_OPERATORS:
            category, description = ADDITIONAL_LE_OPERATORS[operator]
            result['is_law_enforcement'] = 'Law Enforcement' in category or 'Police' in category or 'Sheriff' in category
            result['is_interest'] = True
            if result['confidence'] in ['none', 'low']:
                result['confidence'] = 'high'
            if not result['category']:
                result['category'] = category
                result['description'] = description
            result['identifiers'].append('additional_operator')

        return result

    def _store_position(self, hex_code: str, aircraft: Dict[str, Any]) -> None:
        """Store position for pattern analysis."""
        position = AircraftPosition(
            lat=aircraft['lat'],
            lon=aircraft['lon'],
            altitude=aircraft.get('alt_baro') or aircraft.get('alt_geom'),
            speed=aircraft.get('gs'),
            track=aircraft.get('track'),
            timestamp=timezone.now(),
        )

        if hex_code not in self._position_history:
            self._position_history[hex_code] = []

        self._position_history[hex_code].append(position)

        # Keep only recent positions
        if len(self._position_history[hex_code]) > POSITION_HISTORY_LENGTH:
            self._position_history[hex_code] = self._position_history[hex_code][-POSITION_HISTORY_LENGTH:]

        # Also store in cache for persistence across requests
        cache_key = CACHE_POSITION_HISTORY.format(hex_code)
        cache.set(
            cache_key,
            [p.to_dict() for p in self._position_history[hex_code]],
            POSITION_HISTORY_TTL
        )

    def _load_position_history(self, hex_code: str) -> List[AircraftPosition]:
        """Load position history from cache."""
        if hex_code in self._position_history:
            return self._position_history[hex_code]

        cache_key = CACHE_POSITION_HISTORY.format(hex_code)
        cached = cache.get(cache_key)
        if cached:
            positions = [AircraftPosition.from_dict(p) for p in cached]
            self._position_history[hex_code] = positions
            return positions

        return []

    def _detect_patterns(self, hex_code: str) -> List[PatternDetection]:
        """Detect flight patterns from position history."""
        patterns: List[PatternDetection] = []

        positions = self._load_position_history(hex_code)
        if len(positions) < CIRCLING_MIN_POSITIONS:
            return patterns

        # Detect circling
        circling = self._detect_circling(positions)
        if circling:
            patterns.append(circling)

        # Detect loitering
        loitering = self._detect_loitering(positions)
        if loitering:
            patterns.append(loitering)

        # Detect grid search pattern
        grid = self._detect_grid_pattern(positions)
        if grid:
            patterns.append(grid)

        return patterns

    def _detect_circling(self, positions: List[AircraftPosition]) -> Optional[PatternDetection]:
        """
        Detect circling/orbiting behavior.

        Analysis:
        - Calculate centroid of positions
        - Check if positions are distributed around centroid
        - Check if heading changes consistently (cumulative turn)
        """
        if len(positions) < CIRCLING_MIN_POSITIONS:
            return None

        # Calculate centroid
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        # Calculate distances from centroid
        distances = [
            haversine_distance(center_lat, center_lon, p.lat, p.lon)
            for p in positions
        ]

        # Calculate average and standard deviation
        avg_distance = sum(distances) / len(distances)
        variance = sum((d - avg_distance) ** 2 for d in distances) / len(distances)
        std_dev = math.sqrt(variance)

        # Check if aircraft is staying within a consistent radius
        if avg_distance > CIRCLING_RADIUS_THRESHOLD or avg_distance < 0.1:
            return None

        # Coefficient of variation - lower means more circular
        coeff_var = std_dev / avg_distance if avg_distance > 0 else 1

        if coeff_var > 0.4:  # Too irregular
            return None

        # Calculate cumulative heading change
        total_heading_change = 0
        for i in range(1, len(positions)):
            bearing1 = calculate_bearing(center_lat, center_lon, positions[i-1].lat, positions[i-1].lon)
            bearing2 = calculate_bearing(center_lat, center_lon, positions[i].lat, positions[i].lon)
            change = bearing2 - bearing1
            if change > 180:
                change -= 360
            if change < -180:
                change += 360
            total_heading_change += abs(change)

        # A full circle = 360 degrees
        circles_completed = total_heading_change / 360

        if circles_completed < 0.5:  # Less than half a circle
            return None

        # Calculate confidence based on circle completion and regularity
        confidence = min(1.0, circles_completed * (1 - coeff_var))

        # Determine if this is a speed trap pattern (low altitude, near highway)
        avg_altitude = sum(p.altitude or 0 for p in positions) / len(positions)
        is_speed_trap = avg_altitude < 3000 and avg_distance < 1.0

        pattern_type = 'speed_trap' if is_speed_trap else 'circling'
        description = f"Aircraft circling at {avg_distance:.1f}nm radius"
        if circles_completed > 1:
            description += f", {circles_completed:.1f} orbits completed"

        return PatternDetection(
            pattern_type=pattern_type,
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=avg_distance,
            description=description,
            metadata={
                'circles_completed': round(circles_completed, 2),
                'coefficient_variation': round(coeff_var, 3),
                'avg_altitude': int(avg_altitude),
            }
        )

    def _detect_loitering(self, positions: List[AircraftPosition]) -> Optional[PatternDetection]:
        """Detect loitering (staying in area for extended time)."""
        if len(positions) < 3:
            return None

        # Check time span
        first_time = positions[0].timestamp
        last_time = positions[-1].timestamp
        duration = (last_time - first_time).total_seconds() / 60  # minutes

        if duration < LOITERING_TIME_THRESHOLD:
            return None

        # Calculate bounding box
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]

        lat_range = max(lats) - min(lats)
        lon_range = max(lons) - min(lons)

        # Convert to approximate nm
        lat_range_nm = lat_range * 60
        lon_range_nm = lon_range * 60 * math.cos(math.radians(sum(lats) / len(lats)))

        # If aircraft has stayed within ~5nm box for 10+ minutes
        max_range = max(lat_range_nm, lon_range_nm)
        if max_range > 5.0:
            return None

        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        confidence = min(1.0, (duration / LOITERING_TIME_THRESHOLD) * (1 - max_range / 5.0) * 0.5)

        return PatternDetection(
            pattern_type='loitering',
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=max_range / 2,
            duration_minutes=int(duration),
            description=f"Aircraft loitering for {int(duration)} minutes",
            metadata={
                'area_nm': round(max_range, 2),
            }
        )

    def _detect_grid_pattern(self, positions: List[AircraftPosition]) -> Optional[PatternDetection]:
        """
        Detect grid search pattern (typical of surveillance searches).

        Grid patterns show:
        - Alternating east-west or north-south tracks
        - Regular spacing between tracks
        - Consistent heading changes (~180 degrees)
        """
        if len(positions) < 10:
            return None

        # Look for consistent 180-degree turns
        turn_count = 0
        track_changes = []

        for i in range(2, len(positions)):
            if positions[i].track is not None and positions[i-2].track is not None:
                change = abs(positions[i].track - positions[i-2].track)
                if change > 180:
                    change = 360 - change
                track_changes.append(change)
                if 160 < change < 200:  # ~180 degree turn
                    turn_count += 1

        # Need multiple 180-degree turns for grid pattern
        if turn_count < 3 or len(track_changes) < 5:
            return None

        # Calculate how regular the pattern is
        avg_change = sum(track_changes) / len(track_changes)
        variance = sum((c - avg_change) ** 2 for c in track_changes) / len(track_changes)

        # Grid patterns should have regular turn intervals
        if variance > 2500:  # Too irregular
            return None

        confidence = min(1.0, turn_count / 5)

        # Calculate center
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        return PatternDetection(
            pattern_type='grid_search',
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            description=f"Grid search pattern with {turn_count} track reversals",
            metadata={
                'turn_count': turn_count,
                'track_changes': len(track_changes),
            }
        )

    def _calculate_closing_speed(
        self,
        hex_code: str,
        current_distance: float,
        previous_distance: Optional[float],
        time_delta_seconds: float = 3.0,
    ) -> Optional[float]:
        """Calculate closing speed in knots."""
        if previous_distance is None:
            return None

        distance_change = previous_distance - current_distance  # Positive = closing
        # Convert nm change over seconds to knots (nm/hour)
        closing_speed_knots = (distance_change / time_delta_seconds) * 3600

        return round(closing_speed_knots, 1)

    def _calculate_urgency(
        self,
        distance_nm: float,
        threat_level: str,
        le_info: Dict[str, Any],
        trend: str,
        closing_speed: Optional[float],
        eta_seconds: Optional[int],
        patterns: List[PatternDetection],
    ) -> int:
        """
        Calculate urgency score (0-100).

        Higher score = more urgent threat.
        """
        score = 0

        # Distance factor (closer = higher)
        if distance_nm < 1:
            score += 40
        elif distance_nm < 2:
            score += 30
        elif distance_nm < 5:
            score += 20
        elif distance_nm < 10:
            score += 10

        # Law enforcement factor
        if le_info['is_law_enforcement']:
            score += 25

        # Approaching factor
        if trend == 'approaching':
            score += 15

        # ETA factor
        if eta_seconds is not None:
            if eta_seconds < 60:
                score += 15
            elif eta_seconds < 180:
                score += 10
            elif eta_seconds < 300:
                score += 5

        # Closing speed factor
        if closing_speed and closing_speed > CLOSING_SPEED_ALERT_THRESHOLD:
            score += 10

        # Pattern factors
        for pattern in patterns:
            if pattern.pattern_type == 'circling':
                score += int(15 * pattern.confidence)
            elif pattern.pattern_type == 'speed_trap':
                score += int(20 * pattern.confidence)
            elif pattern.pattern_type == 'loitering':
                score += int(10 * pattern.confidence)
            elif pattern.pattern_type == 'grid_search':
                score += int(15 * pattern.confidence)

        # Threat level factor
        if threat_level == 'critical':
            score += 10
        elif threat_level == 'warning':
            score += 5

        return min(100, score)

    def get_active_threats_for_location(
        self,
        lat: float,
        lon: float,
        radius_nm: float = 25.0,
    ) -> List[Dict[str, Any]]:
        """
        Get cached active threats for a location.

        This retrieves pre-computed threats from cache for quick lookup.
        """
        cache_key = f"{CACHE_ACTIVE_THREATS}:{lat:.2f}:{lon:.2f}"
        cached = cache.get(cache_key)
        if cached:
            return cached
        return []

    def clear_aircraft_history(self, hex_code: str) -> None:
        """Clear position history for an aircraft (when it leaves area)."""
        if hex_code in self._position_history:
            del self._position_history[hex_code]
        if hex_code in self._previous_distances:
            del self._previous_distances[hex_code]
        cache.delete(CACHE_POSITION_HISTORY.format(hex_code))


# Module-level service instance
_cannonball_service: Optional[CannonballService] = None


def get_cannonball_service() -> CannonballService:
    """Get or create the Cannonball service instance."""
    global _cannonball_service
    if _cannonball_service is None:
        _cannonball_service = CannonballService()
    return _cannonball_service


def analyze_threats(
    aircraft_list: List[Dict[str, Any]],
    user_lat: float,
    user_lon: float,
    user_heading: Optional[float] = None,
    radius_nm: float = 25.0,
    altitude_ceiling: int = 20000,
) -> List[Dict[str, Any]]:
    """
    Convenience function to analyze threats.

    Returns list of threat dictionaries.
    """
    service = get_cannonball_service()
    threats = service.analyze_aircraft(
        aircraft_list=aircraft_list,
        user_lat=user_lat,
        user_lon=user_lon,
        user_heading=user_heading,
        radius_nm=radius_nm,
        altitude_ceiling=altitude_ceiling,
    )
    return [t.to_dict() for t in threats]
