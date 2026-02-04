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
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from django.core.cache import cache
from django.utils import timezone

from .law_enforcement_db import (
    calculate_bearing,
    get_direction_name,
    get_threat_level,
    get_trend,
    haversine_distance,
    identify_law_enforcement,
)

logger = logging.getLogger(__name__)

# Cache keys
CACHE_POSITION_HISTORY = "cannonball:positions:{}"
CACHE_PATTERN_DETECTIONS = "cannonball:patterns:{}"
CACHE_ACTIVE_THREATS = "cannonball:threats"
CACHE_HIGHWAY_WATCHERS = "cannonball:highway_watchers"

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
    altitude: int | None
    speed: float | None
    track: float | None
    timestamp: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "lat": self.lat,
            "lon": self.lon,
            "altitude": self.altitude,
            "speed": self.speed,
            "track": self.track,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AircraftPosition":
        return cls(
            lat=data["lat"],
            lon=data["lon"],
            altitude=data.get("altitude"),
            speed=data.get("speed"),
            track=data.get("track"),
            timestamp=datetime.fromisoformat(data["timestamp"]) if data.get("timestamp") else timezone.now(),
        )


@dataclass
class PatternDetection:
    """Detected flight pattern."""

    pattern_type: str  # 'circling', 'loitering', 'grid_search', 'speed_trap', 'highway_patrol'
    confidence: float  # 0-1
    center_lat: float | None = None
    center_lon: float | None = None
    radius_nm: float | None = None
    duration_minutes: int | None = None
    description: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pattern_type": self.pattern_type,
            "confidence": self.confidence,
            "center_lat": self.center_lat,
            "center_lon": self.center_lon,
            "radius_nm": self.radius_nm,
            "duration_minutes": self.duration_minutes,
            "description": self.description,
            "metadata": self.metadata,
        }


@dataclass
class CannonballThreat:
    """Enhanced threat information for Cannonball Mode."""

    hex: str
    callsign: str | None
    category: str
    description: str
    distance_nm: float
    bearing: float
    direction: str
    altitude: int | None
    ground_speed: float | None
    track: float | None
    vertical_rate: int | None
    trend: str
    threat_level: str
    is_law_enforcement: bool
    is_helicopter: bool
    is_surveillance_type: bool
    confidence: str
    urgency_score: int
    closing_speed: float | None = None
    eta_seconds: int | None = None
    patterns: list[PatternDetection] = field(default_factory=list)
    lat: float = 0.0
    lon: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "hex": self.hex,
            "callsign": self.callsign,
            "category": self.category,
            "description": self.description,
            "distance_nm": self.distance_nm,
            "bearing": self.bearing,
            "direction": self.direction,
            "altitude": self.altitude,
            "ground_speed": self.ground_speed,
            "track": self.track,
            "vertical_rate": self.vertical_rate,
            "trend": self.trend,
            "threat_level": self.threat_level,
            "is_law_enforcement": self.is_law_enforcement,
            "is_helicopter": self.is_helicopter,
            "is_surveillance_type": self.is_surveillance_type,
            "confidence": self.confidence,
            "urgency_score": self.urgency_score,
            "closing_speed": self.closing_speed,
            "eta_seconds": self.eta_seconds,
            "patterns": [p.to_dict() for p in self.patterns],
            "lat": self.lat,
            "lon": self.lon,
        }


# Additional callsign patterns for traffic enforcement
TRAFFIC_ENFORCEMENT_PATTERNS: list[tuple[str, str, str]] = [
    # Traffic helicopters
    (r"^TRAFF\d*", "Traffic Enforcement", "Traffic Helicopter"),
    (r"^SPEED\d*", "Traffic Enforcement", "Speed Enforcement"),
    (r"^MOTOR\d*", "Traffic Enforcement", "Motor Patrol"),
    (r"^AIRWATCH\d*", "Traffic Enforcement", "Air Watch Traffic"),
    (r"^EYE\d*", "Traffic Enforcement", "Eye in the Sky"),
    # Highway patrol specific
    (r"^HIGHWAY\d*", "Highway Patrol", "Highway Patrol"),
    (r"^HWAY\d*", "Highway Patrol", "Highway Patrol"),
    (r"^FREEWAY\d*", "Highway Patrol", "Freeway Patrol"),
    (r"^I\d{1,3}PAT", "Highway Patrol", "Interstate Patrol"),
    # More state patrol callsigns
    (r"^ASP\d*", "State Police", "Arizona State Patrol"),
    (r"^CSP\d*", "State Police", "Colorado State Patrol"),
    (r"^GSP\d*", "State Police", "Georgia State Patrol"),
    (r"^KHP\d*", "State Police", "Kansas Highway Patrol"),
    (r"^LSP\d*", "State Police", "Louisiana State Police"),
    (r"^NHP\d*", "State Police", "Nevada Highway Patrol"),
    (r"^NCSHP\d*", "State Police", "North Carolina State Highway Patrol"),
    (r"^UHP\d*", "State Police", "Utah Highway Patrol"),
    (r"^VHP\d*", "State Police", "Virginia Highway Patrol"),
    # County sheriffs air units
    (r"^LASO\d*", "Sheriff Aviation", "Los Angeles County Sheriff"),
    (r"^OCSD\d*", "Sheriff Aviation", "Orange County Sheriff"),
    (r"^SDSO\d*", "Sheriff Aviation", "San Diego County Sheriff"),
    (r"^HCSO\d*", "Sheriff Aviation", "Harris County Sheriff"),
    (r"^PBSO\d*", "Sheriff Aviation", "Palm Beach Sheriff"),
    (r"^BSO\d*", "Sheriff Aviation", "Broward Sheriff"),
    (r"^CCSO\d*", "Sheriff Aviation", "County Sheriff Office"),
    (r"^WCSO\d*", "Sheriff Aviation", "County Sheriff Office"),
    # Additional federal patterns
    (r"^CONUS\d*", "Federal Law Enforcement", "CONUS Operations"),
    (r"^FEDEX\d*", "Federal Law Enforcement", "Federal Excercise"),  # Be careful - might match FedEx
    (r"^JSTARS\d*", "Federal Law Enforcement", "Joint STARS"),
    # Fire/emergency (often work with LE)
    (r"^TANKER\d*", "Fire/Emergency", "Air Tanker"),
    (r"^FIRE\d*", "Fire/Emergency", "Fire Response"),
    (r"^CALFIRE\d*", "Fire/Emergency", "CAL FIRE"),
]

# Additional operator ICAO codes
ADDITIONAL_LE_OPERATORS: dict[str, tuple[str, str]] = {
    # More federal agencies
    "TSA": ("Federal Law Enforcement", "Transportation Security Administration"),
    "NSA": ("Federal Law Enforcement", "National Security Agency"),
    "CIA": ("Federal Law Enforcement", "Central Intelligence Agency"),
    "USCG": ("Federal Law Enforcement", "US Coast Guard"),
    "USSS": ("Federal Law Enforcement", "US Secret Service"),
    # Military (often used for LE support)
    "NG": ("National Guard", "National Guard"),
    "ANG": ("National Guard", "Air National Guard"),
    "USAF": ("Military", "US Air Force"),
    "USA": ("Military", "US Army"),
    "USN": ("Military", "US Navy"),
    # State police aviation
    "TXSP": ("State Police", "Texas State Police"),
    "CASP": ("State Police", "California State Police"),
    "FLHP": ("State Police", "Florida Highway Patrol"),
    "GAHP": ("State Police", "Georgia Highway Patrol"),
    # County/city LE
    "PBCSO": ("Sheriff Aviation", "Palm Beach County Sheriff"),
    "SDPD": ("Police Aviation", "San Diego Police Dept"),
    "PPD": ("Police Aviation", "Phoenix Police Dept"),
    "DPD": ("Police Aviation", "Dallas Police Dept"),
    "APD": ("Police Aviation", "Austin Police Dept"),
    "SPD": ("Police Aviation", "Seattle Police Dept"),
    "OPD": ("Police Aviation", "Oakland Police Dept"),
    "SFO": ("Police Aviation", "San Francisco Police Dept"),
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
        self._position_history: dict[str, list[AircraftPosition]] = {}
        self._pattern_cache: dict[str, list[PatternDetection]] = {}
        self._previous_distances: dict[str, float] = {}

    def analyze_aircraft(
        self,
        aircraft_list: list[dict[str, Any]],
        user_lat: float,
        user_lon: float,
        user_heading: float | None = None,
        radius_nm: float = 25.0,
        altitude_ceiling: int = 20000,
    ) -> list[CannonballThreat]:
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
        threats: list[CannonballThreat] = []

        for ac in aircraft_list:
            if not ac.get("lat") or not ac.get("lon"):
                continue

            # Calculate distance
            ac_lat = ac["lat"]
            ac_lon = ac["lon"]
            distance_nm = haversine_distance(user_lat, user_lon, ac_lat, ac_lon)

            # Apply radius filter
            if distance_nm > radius_nm:
                continue

            # Apply altitude filter
            altitude = ac.get("alt_baro") or ac.get("alt_geom") or ac.get("altitude") or 0
            if altitude > altitude_ceiling:
                continue

            # Get hex identifier
            hex_code = ac.get("hex", "")
            if not hex_code:
                continue

            # Identify law enforcement characteristics
            le_info = self._enhanced_identify_le(ac)

            # Skip if not interesting
            if not le_info["is_interest"]:
                continue

            # Calculate bearing
            bearing = calculate_bearing(user_lat, user_lon, ac_lat, ac_lon)

            # Get trend and closing speed
            prev_distance = self._previous_distances.get(hex_code)
            trend = get_trend(distance_nm, prev_distance)
            closing_speed = self._calculate_closing_speed(hex_code, distance_nm, prev_distance)

            # Calculate ETA if approaching
            eta_seconds = None
            if closing_speed and closing_speed > 0 and trend == "approaching":
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
                callsign=(ac.get("flight") or ac.get("callsign") or "").strip() or None,
                category=le_info.get("category") or "Unknown",
                description=le_info.get("description") or "",
                distance_nm=round(distance_nm, 2),
                bearing=round(bearing, 1),
                direction=get_direction_name(bearing),
                altitude=altitude,
                ground_speed=ac.get("gs"),
                track=ac.get("track"),
                vertical_rate=ac.get("baro_rate") or ac.get("geom_rate"),
                trend=trend,
                threat_level=threat_level,
                is_law_enforcement=le_info["is_law_enforcement"],
                is_helicopter=le_info["is_helicopter"],
                is_surveillance_type=le_info["is_surveillance_type"],
                confidence=le_info["confidence"],
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
        threat_order = {"critical": 0, "warning": 1, "info": 2}
        threats.sort(key=lambda t: (-t.urgency_score, threat_order.get(t.threat_level, 3), t.distance_nm))

        return threats

    def _enhanced_identify_le(self, aircraft: dict[str, Any]) -> dict[str, Any]:
        """
        Enhanced law enforcement identification with additional patterns.
        """
        import re

        # Start with base identification
        result = identify_law_enforcement(
            hex_code=aircraft.get("hex"),
            callsign=aircraft.get("flight") or aircraft.get("callsign"),
            operator=aircraft.get("ownOp") or aircraft.get("operator"),
            registration=aircraft.get("r") or aircraft.get("registration"),
            category=aircraft.get("category"),
            type_code=aircraft.get("t") or aircraft.get("type"),
        )

        # Check additional traffic enforcement patterns
        callsign = (aircraft.get("flight") or aircraft.get("callsign") or "").strip().upper()
        if callsign:
            for pattern, category, description in TRAFFIC_ENFORCEMENT_PATTERNS:
                if re.match(pattern, callsign, re.IGNORECASE):
                    result["is_law_enforcement"] = category not in ["Fire/Emergency"]
                    result["is_interest"] = True
                    if result["confidence"] == "none":
                        result["confidence"] = "high"
                    if not result["category"]:
                        result["category"] = category
                        result["description"] = description
                    result["identifiers"].append("traffic_pattern")
                    break

        # Check additional operator codes
        operator = (aircraft.get("ownOp") or aircraft.get("operator") or "").strip().upper()
        if operator and operator in ADDITIONAL_LE_OPERATORS:
            category, description = ADDITIONAL_LE_OPERATORS[operator]
            result["is_law_enforcement"] = (
                "Law Enforcement" in category or "Police" in category or "Sheriff" in category
            )
            result["is_interest"] = True
            if result["confidence"] in ["none", "low"]:
                result["confidence"] = "high"
            if not result["category"]:
                result["category"] = category
                result["description"] = description
            result["identifiers"].append("additional_operator")

        return result

    def _store_position(self, hex_code: str, aircraft: dict[str, Any]) -> None:
        """Store position for pattern analysis."""
        position = AircraftPosition(
            lat=aircraft["lat"],
            lon=aircraft["lon"],
            altitude=aircraft.get("alt_baro") or aircraft.get("alt_geom"),
            speed=aircraft.get("gs"),
            track=aircraft.get("track"),
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
        cache.set(cache_key, [p.to_dict() for p in self._position_history[hex_code]], POSITION_HISTORY_TTL)

    def _load_position_history(self, hex_code: str) -> list[AircraftPosition]:
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

    def _detect_patterns(self, hex_code: str) -> list[PatternDetection]:
        """Detect flight patterns from position history."""
        patterns: list[PatternDetection] = []

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

        # Enhanced pattern detection (Phase 2)
        # Detect stakeout pattern
        stakeout = self._detect_stakeout(positions)
        if stakeout:
            patterns.append(stakeout)

        # Detect racetrack orbit pattern
        racetrack = self._detect_racetrack(positions)
        if racetrack:
            patterns.append(racetrack)

        # Detect highway tracking pattern
        highway = self._detect_highway_parallel(positions)
        if highway:
            patterns.append(highway)

        # Detect area search pattern
        area_search = self._detect_area_search(positions)
        if area_search:
            patterns.append(area_search)

        return patterns

    def _detect_circling(self, positions: list[AircraftPosition]) -> PatternDetection | None:
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
        distances = [haversine_distance(center_lat, center_lon, p.lat, p.lon) for p in positions]

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
            bearing1 = calculate_bearing(center_lat, center_lon, positions[i - 1].lat, positions[i - 1].lon)
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

        pattern_type = "speed_trap" if is_speed_trap else "circling"
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
                "circles_completed": round(circles_completed, 2),
                "coefficient_variation": round(coeff_var, 3),
                "avg_altitude": int(avg_altitude),
            },
        )

    def _detect_loitering(self, positions: list[AircraftPosition]) -> PatternDetection | None:
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
            pattern_type="loitering",
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=max_range / 2,
            duration_minutes=int(duration),
            description=f"Aircraft loitering for {int(duration)} minutes",
            metadata={
                "area_nm": round(max_range, 2),
            },
        )

    def _detect_grid_pattern(self, positions: list[AircraftPosition]) -> PatternDetection | None:
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
            if positions[i].track is not None and positions[i - 2].track is not None:
                change = abs(positions[i].track - positions[i - 2].track)
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
            pattern_type="grid_search",
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            description=f"Grid search pattern with {turn_count} track reversals",
            metadata={
                "turn_count": turn_count,
                "track_changes": len(track_changes),
            },
        )

    def _calculate_closing_speed(
        self,
        hex_code: str,
        current_distance: float,
        previous_distance: float | None,
        time_delta_seconds: float = 3.0,
    ) -> float | None:
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
        le_info: dict[str, Any],
        trend: str,
        closing_speed: float | None,
        eta_seconds: int | None,
        patterns: list[PatternDetection],
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
        if le_info["is_law_enforcement"]:
            score += 25

        # Approaching factor
        if trend == "approaching":
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
            if pattern.pattern_type == "circling":
                score += int(15 * pattern.confidence)
            elif pattern.pattern_type == "speed_trap":
                score += int(20 * pattern.confidence)
            elif pattern.pattern_type == "loitering":
                score += int(10 * pattern.confidence)
            elif pattern.pattern_type == "grid_search":
                score += int(15 * pattern.confidence)
            # New enhanced patterns
            elif pattern.pattern_type == "stakeout":
                score += int(18 * pattern.confidence)  # High urgency - focused surveillance
            elif pattern.pattern_type == "racetrack":
                score += int(15 * pattern.confidence)  # Systematic surveillance orbit
            elif pattern.pattern_type == "highway_tracking":
                score += int(20 * pattern.confidence)  # Traffic enforcement
            elif pattern.pattern_type == "area_search":
                score += int(12 * pattern.confidence)  # Search operation

        # Threat level factor
        if threat_level == "critical":
            score += 10
        elif threat_level == "warning":
            score += 5

        return min(100, score)

    def get_active_threats_for_location(
        self,
        lat: float,
        lon: float,
        radius_nm: float = 25.0,
    ) -> list[dict[str, Any]]:
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

    # ========================================
    # Enhanced Pattern Detection (Phase 2)
    # ========================================

    def _detect_stakeout(self, positions: list[AircraftPosition]) -> PatternDetection | None:
        """
        Detect stakeout loitering pattern.

        Characteristics:
        - Extended time (20+ minutes) in a very small area (<0.5nm radius)
        - Consistent altitude (minimal variation)
        - Low ground speed
        """
        if len(positions) < 10:
            return None

        # Check time span - need at least 20 minutes
        first_time = positions[0].timestamp
        last_time = positions[-1].timestamp
        duration_minutes = (last_time - first_time).total_seconds() / 60

        if duration_minutes < 20:
            return None

        # Calculate centroid and spread
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        # Calculate distances from centroid
        distances = [haversine_distance(center_lat, center_lon, p.lat, p.lon) for p in positions]
        avg_distance = sum(distances) / len(distances)
        max_distance = max(distances)

        # Stakeout: very tight area - less than 0.5nm radius
        if max_distance > 0.5:
            return None

        # Check altitude consistency
        altitudes = [p.altitude for p in positions if p.altitude]
        if altitudes:
            avg_altitude = sum(altitudes) / len(altitudes)
            altitude_variance = sum((a - avg_altitude) ** 2 for a in altitudes) / len(altitudes)
            altitude_std = math.sqrt(altitude_variance)
            altitude_consistent = altitude_std < 200  # Less than 200ft variation
        else:
            altitude_consistent = False
            avg_altitude = 0

        # Check for low ground speed
        speeds = [p.speed for p in positions if p.speed is not None]
        avg_speed = sum(speeds) / len(speeds) if speeds else 0
        low_speed = avg_speed < 80  # Less than 80 knots average

        if not altitude_consistent:
            return None

        # Calculate confidence
        confidence = 0.0
        confidence += min(0.4, duration_minutes / 60)  # Up to 0.4 for duration
        confidence += 0.3 if altitude_consistent else 0
        confidence += 0.2 if low_speed else 0
        confidence += 0.1 * (1 - avg_distance / 0.5)  # Tighter = more confident

        confidence = min(1.0, confidence)

        if confidence < 0.5:
            return None

        return PatternDetection(
            pattern_type="stakeout",
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=avg_distance,
            duration_minutes=int(duration_minutes),
            description=f"Stakeout pattern: {int(duration_minutes)}min at {avg_distance:.2f}nm spread, {int(avg_altitude)}ft",
            metadata={
                "duration_minutes": int(duration_minutes),
                "avg_altitude": int(avg_altitude),
                "altitude_std": round(altitude_std, 1) if altitudes else None,
                "avg_speed": round(avg_speed, 1),
                "max_spread_nm": round(max_distance, 3),
            },
        )

    def _detect_racetrack(self, positions: list[AircraftPosition]) -> PatternDetection | None:
        """
        Detect racetrack/figure-8 orbit pattern.

        Characteristics:
        - Alternating left and right turns
        - Consistent endpoint locations
        - Elongated oval pattern
        """
        if len(positions) < 15:
            return None

        # Extract tracks and look for alternating turn directions
        tracks = [p.track for p in positions if p.track is not None]
        if len(tracks) < 10:
            return None

        # Calculate heading changes between consecutive positions
        heading_changes = []
        for i in range(1, len(tracks)):
            change = tracks[i] - tracks[i - 1]
            # Normalize to -180 to 180
            if change > 180:
                change -= 360
            if change < -180:
                change += 360
            heading_changes.append(change)

        # Look for alternating significant turns (>90 degrees cumulative)
        turn_segments = []
        current_turn = 0
        for change in heading_changes:
            current_turn += change
            if abs(current_turn) > 150:  # Significant turn completed
                turn_segments.append(1 if current_turn > 0 else -1)
                current_turn = 0

        # Need at least 3 turn segments for racetrack
        if len(turn_segments) < 3:
            return None

        # Check for alternating pattern
        alternating_count = 0
        for i in range(1, len(turn_segments)):
            if turn_segments[i] != turn_segments[i - 1]:
                alternating_count += 1

        alternating_ratio = alternating_count / max(1, len(turn_segments) - 1)

        if alternating_ratio < 0.7:  # Need mostly alternating turns
            return None

        # Calculate center and dimensions
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        lat_range = max(lats) - min(lats)
        lon_range = max(lons) - min(lons)
        lat_range_nm = lat_range * 60
        lon_range_nm = lon_range * 60 * math.cos(math.radians(center_lat))

        # Racetrack should be elongated (aspect ratio > 1.5)
        aspect_ratio = max(lat_range_nm, lon_range_nm) / max(0.1, min(lat_range_nm, lon_range_nm))
        if aspect_ratio < 1.3:
            return None

        confidence = min(1.0, alternating_ratio * 0.5 + (len(turn_segments) / 10) * 0.3 + 0.2)

        return PatternDetection(
            pattern_type="racetrack",
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=max(lat_range_nm, lon_range_nm) / 2,
            description=f"Racetrack orbit: {len(turn_segments)} turns, {aspect_ratio:.1f} aspect ratio",
            metadata={
                "turn_count": len(turn_segments),
                "alternating_ratio": round(alternating_ratio, 2),
                "aspect_ratio": round(aspect_ratio, 2),
                "length_nm": round(max(lat_range_nm, lon_range_nm), 2),
                "width_nm": round(min(lat_range_nm, lon_range_nm), 2),
            },
        )

    def _detect_highway_parallel(self, positions: list[AircraftPosition]) -> PatternDetection | None:
        """
        Detect highway tracking/parallel flight pattern.

        Characteristics:
        - Consistent heading for extended distance
        - Low altitude
        - Moderate speed
        - Linear track
        """
        if len(positions) < 8:
            return None

        # Extract tracks
        tracks = [p.track for p in positions if p.track is not None]
        if len(tracks) < 6:
            return None

        # Calculate average heading and variance
        # Use circular mean for headings
        sin_sum = sum(math.sin(math.radians(t)) for t in tracks)
        cos_sum = sum(math.cos(math.radians(t)) for t in tracks)
        avg_heading = math.degrees(math.atan2(sin_sum, cos_sum)) % 360

        # Calculate heading deviation
        heading_deviations = []
        for t in tracks:
            diff = abs(t - avg_heading)
            if diff > 180:
                diff = 360 - diff
            heading_deviations.append(diff)

        avg_deviation = sum(heading_deviations) / len(heading_deviations)

        # Highway parallel: very consistent heading (deviation < 15 degrees)
        if avg_deviation > 15:
            return None

        # Check altitude - should be low
        altitudes = [p.altitude for p in positions if p.altitude]
        if altitudes:
            avg_altitude = sum(altitudes) / len(altitudes)
            if avg_altitude > 5000:  # Too high for highway monitoring
                return None
        else:
            avg_altitude = 0

        # Calculate track length
        total_distance = 0
        for i in range(1, len(positions)):
            total_distance += haversine_distance(
                positions[i - 1].lat, positions[i - 1].lon, positions[i].lat, positions[i].lon
            )

        # Need at least 2nm of linear flight for highway tracking
        if total_distance < 2.0:
            return None

        # Calculate linearity (ratio of direct distance to path distance)
        direct_distance = haversine_distance(positions[0].lat, positions[0].lon, positions[-1].lat, positions[-1].lon)
        linearity = direct_distance / max(0.1, total_distance)

        if linearity < 0.7:  # Too much deviation from straight line
            return None

        # Calculate center
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        confidence = min(1.0, linearity * 0.4 + (1 - avg_deviation / 15) * 0.3 + min(0.3, total_distance / 10))

        return PatternDetection(
            pattern_type="highway_tracking",
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=total_distance / 2,
            description=f"Highway parallel: {avg_heading:.0f}° heading, {total_distance:.1f}nm track, {int(avg_altitude)}ft",
            metadata={
                "avg_heading": round(avg_heading, 1),
                "heading_deviation": round(avg_deviation, 1),
                "track_length_nm": round(total_distance, 2),
                "linearity": round(linearity, 3),
                "avg_altitude": int(avg_altitude),
            },
        )

    def _detect_area_search(self, positions: list[AircraftPosition]) -> PatternDetection | None:
        """
        Detect expanding area search pattern.

        Characteristics:
        - Systematic coverage of an area
        - Multiple parallel tracks with consistent spacing
        - Gradual expansion from a center point
        """
        if len(positions) < 15:
            return None

        # Calculate bounding box over time
        lats = [p.lat for p in positions]
        lons = [p.lon for p in positions]

        # Check if area is expanding over time
        # Split positions into thirds and compare coverage areas
        third = len(positions) // 3
        if third < 3:
            return None

        areas = []
        for i in range(3):
            start = i * third
            end = start + third if i < 2 else len(positions)
            section = positions[start:end]

            section_lats = [p.lat for p in section]
            section_lons = [p.lon for p in section]

            lat_range = max(section_lats) - min(section_lats)
            lon_range = max(section_lons) - min(section_lons)

            # Convert to approximate nm²
            lat_nm = lat_range * 60
            lon_nm = lon_range * 60 * math.cos(math.radians(sum(section_lats) / len(section_lats)))
            area = lat_nm * lon_nm
            areas.append(area)

        # Check for expansion (each section larger than previous)
        expanding = all(areas[i] >= areas[i - 1] * 0.8 for i in range(1, len(areas)))

        if not expanding or areas[-1] < 0.5:  # Need meaningful final area
            return None

        # Check for systematic coverage (look at track changes)
        tracks = [p.track for p in positions if p.track is not None]
        if len(tracks) < 10:
            return None

        # Count 180-degree turns (characteristic of search patterns)
        turn_count = 0
        for i in range(2, len(tracks)):
            change = abs(tracks[i] - tracks[i - 2])
            if change > 180:
                change = 360 - change
            if 160 < change < 200:
                turn_count += 1

        # Need multiple systematic turns
        if turn_count < 2:
            return None

        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)

        # Calculate total area covered
        lat_range_nm = (max(lats) - min(lats)) * 60
        lon_range_nm = (max(lons) - min(lons)) * 60 * math.cos(math.radians(center_lat))
        total_area = lat_range_nm * lon_range_nm

        confidence = min(1.0, (turn_count / 5) * 0.4 + 0.3 + min(0.3, total_area / 10))

        return PatternDetection(
            pattern_type="area_search",
            confidence=confidence,
            center_lat=center_lat,
            center_lon=center_lon,
            radius_nm=math.sqrt(total_area) / 2,
            description=f"Area search: {total_area:.1f}nm² covered, {turn_count} track reversals",
            metadata={
                "area_nm_sq": round(total_area, 2),
                "turn_count": turn_count,
                "expansion_ratio": round(areas[-1] / max(0.01, areas[0]), 2),
            },
        )

    def _calculate_pattern_confidence(
        self,
        pattern: PatternDetection,
        le_info: dict[str, Any] | None = None,
        history: list | None = None,
    ) -> float:
        """
        Calculate enhanced confidence for a pattern considering multiple factors.

        Args:
            pattern: Detected pattern
            le_info: Law enforcement identification info
            history: Historical pattern data for this aircraft

        Returns:
            Adjusted confidence score 0.0-1.0
        """
        base_confidence = pattern.confidence

        # Boost confidence if aircraft is known LE
        if le_info and le_info.get("is_law_enforcement"):
            base_confidence = min(1.0, base_confidence + 0.2)

        # Boost confidence if aircraft matches surveillance type
        if le_info and le_info.get("is_surveillance_type"):
            base_confidence = min(1.0, base_confidence + 0.1)

        # Consider pattern quality metrics from metadata
        metadata = pattern.metadata or {}

        # Stakeout: longer duration = higher confidence
        if pattern.pattern_type == "stakeout":
            duration = metadata.get("duration_minutes", 0)
            if duration > 60:
                base_confidence = min(1.0, base_confidence + 0.15)
            elif duration > 30:
                base_confidence = min(1.0, base_confidence + 0.1)

        # Racetrack: more turns = higher confidence
        if pattern.pattern_type == "racetrack":
            turns = metadata.get("turn_count", 0)
            if turns > 6:
                base_confidence = min(1.0, base_confidence + 0.15)

        # Highway tracking: longer track = higher confidence
        if pattern.pattern_type == "highway_tracking":
            length = metadata.get("track_length_nm", 0)
            if length > 5:
                base_confidence = min(1.0, base_confidence + 0.1)

        return base_confidence


# Module-level service instance
_cannonball_service: CannonballService | None = None


def get_cannonball_service() -> CannonballService:
    """Get or create the Cannonball service instance."""
    global _cannonball_service
    if _cannonball_service is None:
        _cannonball_service = CannonballService()
    return _cannonball_service


def analyze_threats(
    aircraft_list: list[dict[str, Any]],
    user_lat: float,
    user_lon: float,
    user_heading: float | None = None,
    radius_nm: float = 25.0,
    altitude_ceiling: int = 20000,
) -> list[dict[str, Any]]:
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
