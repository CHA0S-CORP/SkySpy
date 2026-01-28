"""
Safety monitoring service for TCAS conflicts and dangerous flight parameters.

Monitors aircraft for:
- Emergency squawk detection (7500, 7600, 7700)
- TCAS Resolution Advisory detection (rapid climb/descent maneuvers)
- Extreme vertical speed monitoring
- Vertical speed reversals (potential TCAS RA response)
- Proximity conflicts between aircraft pairs
"""
import logging
import math
import time
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Set

from django.conf import settings
from django.utils import timezone
from channels.layers import get_channel_layer

from skyspy.models import SafetyEvent
from skyspy.utils import sync_group_send

logger = logging.getLogger(__name__)

# Emergency squawk codes and their meanings
EMERGENCY_SQUAWKS = {
    "7500": {"type": "hijack", "label": "HIJACK", "severity": "critical"},
    "7600": {"type": "radio_failure", "label": "RADIO FAILURE", "severity": "warning"},
    "7700": {"type": "emergency", "label": "EMERGENCY", "severity": "critical"},
}

# Major airport locations for takeoff/landing filtering (Class B and C)
# Format: (icao, lat, lon)
MAJOR_AIRPORTS = [
    # Class B
    ("KATL", 33.6367, -84.4281),
    ("KBOS", 42.3656, -71.0096),
    ("KORD", 41.9742, -87.9073),
    ("KDFW", 32.8998, -97.0403),
    ("KDEN", 39.8561, -104.6737),
    ("KDTW", 42.2124, -83.3534),
    ("KEWR", 40.6895, -74.1745),
    ("KIAH", 29.9902, -95.3368),
    ("KJFK", 40.6413, -73.7781),
    ("KLAS", 36.0840, -115.1537),
    ("KLAX", 33.9416, -118.4085),
    ("KMCO", 28.4312, -81.3081),
    ("KMIA", 25.7959, -80.2870),
    ("KMSP", 44.8848, -93.2223),
    ("KPHL", 39.8729, -75.2437),
    ("KPHX", 33.4373, -112.0078),
    ("KSEA", 47.4502, -122.3088),
    ("KSFO", 37.6213, -122.3790),
    ("KSLC", 40.7899, -111.9791),
    ("KTPA", 27.9755, -82.5332),
    # Class C (sample)
    ("KAUS", 30.1975, -97.6664),
    ("KBNA", 36.1245, -86.6782),
    ("KBUF", 42.9405, -78.7322),
    ("KCLE", 41.4117, -81.8498),
    ("KCLT", 35.2140, -80.9431),
    ("KCVG", 39.0488, -84.6678),
    ("KHOU", 29.6454, -95.2789),
    ("KIND", 39.7173, -86.2944),
    ("KMCI", 39.2976, -94.7139),
    ("KMEM", 35.0424, -89.9767),
    ("KMKE", 42.9472, -87.8966),
    ("KMSY", 29.9934, -90.2580),
    ("KOAK", 37.7213, -122.2208),
    ("KOMA", 41.3032, -95.8941),
    ("KONT", 34.0560, -117.6012),
    ("KPDX", 45.5898, -122.5951),
    ("KPIT", 40.4915, -80.2329),
    ("KRDU", 35.8776, -78.7875),
    ("KSAN", 32.7336, -117.1897),
    ("KSAT", 29.5337, -98.4698),
    ("KSJC", 37.3626, -121.9291),
    ("KSMF", 38.6954, -121.5908),
    ("KSTL", 38.7487, -90.3700),
]


def calculate_distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles using haversine formula."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_valid_position(lat: Optional[float], lon: Optional[float]) -> bool:
    """Check if position coordinates are valid."""
    if lat is None or lon is None:
        return False
    return -90 <= lat <= 90 and -180 <= lon <= 180


def safe_int_altitude(alt) -> Optional[int]:
    """Safely convert altitude to int, handling 'ground' and other special values."""
    if alt is None:
        return None
    if isinstance(alt, str):
        if alt.lower() == 'ground':
            return 0
        try:
            return int(alt)
        except ValueError:
            return None
    if isinstance(alt, (int, float)):
        return int(alt)
    return None


class SafetyMonitor:
    """
    Monitors for TCAS-like conflicts and dangerous flight parameters.

    Detection capabilities:
    - Emergency squawk detection (7500, 7600, 7700)
    - TCAS Resolution Advisory detection (rapid climb/descent maneuvers)
    - Extreme vertical speed monitoring
    - Vertical speed reversals (potential TCAS RA response)
    - Proximity conflicts between aircraft pairs
    """

    EVENT_COOLDOWN = 60  # seconds
    HISTORY_RETENTION = 30  # seconds
    EVENT_EXPIRY = 300  # 5 minutes - events expire if not refreshed

    def __init__(self):
        # Thresholds from settings
        self.vs_change_threshold = getattr(settings, 'SAFETY_VS_CHANGE_THRESHOLD', 3000)
        self.vs_extreme_threshold = getattr(settings, 'SAFETY_VS_EXTREME_THRESHOLD', 6000)
        self.proximity_nm = getattr(settings, 'SAFETY_PROXIMITY_NM', 1.0)
        self.altitude_diff_ft = getattr(settings, 'SAFETY_ALTITUDE_DIFF_FT', 1000)
        self.closure_rate_kt = getattr(settings, 'SAFETY_CLOSURE_RATE_KT', 100)
        self.tcas_vs_threshold = getattr(settings, 'SAFETY_TCAS_VS_THRESHOLD', 1500)

        # State tracking
        self._aircraft_state: Dict[str, dict] = {}
        self._event_cooldown: Dict[str, float] = {}
        self._active_events: Dict[str, dict] = {}  # event_id -> event data
        self._acknowledged_events: Set[str] = set()  # Set of acknowledged event IDs
        self._enabled = getattr(settings, 'SAFETY_MONITORING_ENABLED', True)
        self._last_cleanup = 0.0

    @property
    def enabled(self) -> bool:
        """Check if safety monitoring is enabled."""
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool):
        """Enable or disable safety monitoring."""
        self._enabled = value

    @staticmethod
    def _build_aircraft_snapshot(ac: dict) -> dict:
        """Build a telemetry snapshot from raw aircraft data."""
        return {
            "hex": ac.get("hex"),
            "flight": (ac.get("flight") or "").strip(),
            "lat": ac.get("lat"),
            "lon": ac.get("lon"),
            "alt_baro": ac.get("alt_baro") or ac.get("alt"),
            "alt_geom": ac.get("alt_geom"),
            "gs": ac.get("gs"),
            "track": ac.get("track"),
            "baro_rate": ac.get("baro_rate") or ac.get("vr"),
            "geom_rate": ac.get("geom_rate"),
            "squawk": ac.get("squawk"),
            "category": ac.get("category"),
            "nav_altitude_mcp": ac.get("nav_altitude_mcp"),
            "nav_heading": ac.get("nav_heading"),
            "nav_modes": ac.get("nav_modes"),
            "emergency": ac.get("emergency"),
            "rssi": ac.get("rssi"),
        }

    def _get_cooldown_key(self, event_type: str, icao: str, icao_2: Optional[str] = None) -> str:
        """Generate a cooldown key for an event."""
        if icao_2:
            # Ensure both values are not None before sorting
            if icao is None or icao_2 is None:
                return f"{event_type}:{icao or ''}:{icao_2 or ''}"
            pair = tuple(sorted([icao, icao_2]))
            return f"{event_type}:{pair[0]}:{pair[1]}"
        return f"{event_type}:{icao}"

    def _can_trigger_event(self, event_type: str, icao: str, icao_2: Optional[str] = None) -> bool:
        """Check if we can trigger an event (respects cooldown)."""
        if icao is None:
            return False
        key = self._get_cooldown_key(event_type, icao, icao_2)
        now = time.time()
        last_trigger = self._event_cooldown.get(key, 0)
        return (now - last_trigger) > self.EVENT_COOLDOWN

    def _mark_event_triggered(self, event_type: str, icao: str, icao_2: Optional[str] = None):
        """Mark an event as triggered."""
        key = self._get_cooldown_key(event_type, icao, icao_2)
        self._event_cooldown[key] = time.time()

    def _cleanup_old_state(self):
        """Remove state older than retention period and expired events."""
        now = time.time()

        # Only cleanup every 5 seconds to reduce overhead
        if now - self._last_cleanup < 5.0:
            return
        self._last_cleanup = now

        cutoff = now - self.HISTORY_RETENTION
        event_cutoff = now - self.EVENT_EXPIRY

        # Clean up old aircraft state
        to_remove = [
            icao for icao, state in self._aircraft_state.items()
            if state.get("last_update", 0) < cutoff
        ]
        for icao in to_remove:
            del self._aircraft_state[icao]

        # Clean up old cooldowns
        old_cooldowns = [k for k, v in self._event_cooldown.items() if v < cutoff]
        for k in old_cooldowns:
            del self._event_cooldown[k]

        # Clean up expired events
        expired_events = [
            (eid, event) for eid, event in self._active_events.items()
            if event.get("last_seen", 0) < event_cutoff
        ]
        for eid, event in expired_events:
            del self._active_events[eid]
            self._acknowledged_events.discard(eid)
            # Broadcast event resolution for expired events
            self.broadcast_event_resolved(event)

    def _generate_event_id(self, event_type: str, icao: str, icao_2: Optional[str] = None) -> str:
        """Generate a stable event ID for deduplication."""
        if icao_2:
            pair = tuple(sorted([icao, icao_2]))
            return f"{event_type}:{pair[0]}:{pair[1]}"
        return f"{event_type}:{icao}"

    def _store_event(self, event: dict) -> dict:
        """Store an event and return it with ID and metadata."""
        event_id = self._generate_event_id(
            event["event_type"],
            event.get("icao") or event.get("icao_hex"),
            event.get("icao_2") or event.get("icao_hex_2")
        )
        now = time.time()

        # Check if event already exists
        if event_id in self._active_events:
            # Update existing event
            existing = self._active_events[event_id]
            existing.update(event)
            existing["last_seen"] = now
            existing["acknowledged"] = event_id in self._acknowledged_events
            return existing
        else:
            # New event
            event["id"] = event_id
            event["created_at"] = now
            event["last_seen"] = now
            event["acknowledged"] = False
            self._active_events[event_id] = event
            return event

    def find_event_by_db_id(self, db_id: int) -> Optional[str]:
        """Find an active event's string ID by its database ID."""
        for event_id, event in self._active_events.items():
            if event.get("db_id") == db_id:
                return event_id
        return None

    def acknowledge_event(self, event_id: str) -> bool:
        """Acknowledge an event by ID. Returns True if successful."""
        # Direct string ID match
        if event_id in self._active_events:
            self._acknowledged_events.add(event_id)
            self._active_events[event_id]["acknowledged"] = True
            self.broadcast_event_updated(self._active_events[event_id])
            return True

        # Try numeric db_id lookup
        try:
            db_id = int(event_id)
            for eid, event in self._active_events.items():
                if event.get("db_id") == db_id:
                    self._acknowledged_events.add(eid)
                    event["acknowledged"] = True
                    self.broadcast_event_updated(event)
                    return True
        except (ValueError, TypeError):
            logger.debug(f"Event ID '{event_id}' is not a valid numeric ID")

        return False

    def unacknowledge_event(self, event_id: str) -> bool:
        """Remove acknowledgment from an event. Returns True if successful."""
        # Direct string ID match
        if event_id in self._active_events:
            self._acknowledged_events.discard(event_id)
            self._active_events[event_id]["acknowledged"] = False
            self.broadcast_event_updated(self._active_events[event_id])
            return True

        # Try numeric db_id lookup
        try:
            db_id = int(event_id)
            for eid, event in self._active_events.items():
                if event.get("db_id") == db_id:
                    self._acknowledged_events.discard(eid)
                    event["acknowledged"] = False
                    self.broadcast_event_updated(event)
                    return True
        except (ValueError, TypeError):
            logger.debug(f"Event ID '{event_id}' is not a valid numeric ID for unacknowledge")

        return False

    def get_active_events(self, include_acknowledged: bool = True) -> List[dict]:
        """Get all active safety events."""
        events = list(self._active_events.values())
        if not include_acknowledged:
            events = [e for e in events if not e.get("acknowledged", False)]
        return events

    def clear_event(self, event_id: str) -> bool:
        """Remove an event entirely. Returns True if successful."""
        # Direct string ID match
        if event_id in self._active_events:
            event = self._active_events[event_id]
            del self._active_events[event_id]
            self._acknowledged_events.discard(event_id)
            self.broadcast_event_resolved(event)
            return True

        # Try numeric db_id lookup
        try:
            db_id = int(event_id)
            for eid, event in list(self._active_events.items()):
                if event.get("db_id") == db_id:
                    del self._active_events[eid]
                    self._acknowledged_events.discard(eid)
                    self.broadcast_event_resolved(event)
                    return True
        except (ValueError, TypeError):
            logger.debug(f"Event ID '{event_id}' is not a valid numeric ID for clear")

        return False

    def clear_all_events(self):
        """Clear all active events and acknowledgments."""
        self._active_events.clear()
        self._acknowledged_events.clear()

    def _is_near_major_airport(self, lat: float, lon: float, radius_nm: float = 5.0) -> bool:
        """Check if a position is within radius of a major airport."""
        for icao, apt_lat, apt_lon in MAJOR_AIRPORTS:
            dist = calculate_distance_nm(lat, lon, apt_lat, apt_lon)
            if dist <= radius_nm:
                return True
        return False

    def _is_takeoff_landing_pair(self, pos1: dict, pos2: dict) -> bool:
        """
        Check if two aircraft appear to be a takeoff/landing pair at an airport.

        Returns True if:
        - Both are near a major airport (within 5nm)
        - Both are at low altitude (<3000ft)
        - One is climbing (positive VS) and one is descending (negative VS)
        """
        # Both must be at low altitude
        if pos1["alt"] > 3000 or pos2["alt"] > 3000:
            return False

        # Need vertical rate data for both
        vr1 = pos1.get("vr")
        vr2 = pos2.get("vr")
        if vr1 is None or vr2 is None:
            return False

        # One climbing, one descending (opposite signs)
        if not (vr1 * vr2 < 0):
            return False

        # At least one should have significant vertical rate
        if abs(vr1) < 300 and abs(vr2) < 300:
            return False

        # Both must be near a major airport
        near_airport_1 = self._is_near_major_airport(pos1["lat"], pos1["lon"])
        near_airport_2 = self._is_near_major_airport(pos2["lat"], pos2["lon"])

        return near_airport_1 and near_airport_2

    def _calculate_closure_rate(self, pos1: dict, pos2: dict) -> Optional[float]:
        """Calculate closure rate between two aircraft in knots."""
        if pos1["gs"] is None or pos2["gs"] is None:
            return None
        if pos1["track"] is None or pos2["track"] is None:
            return None

        lat_diff = (pos2["lat"] - pos1["lat"]) * 60
        lon_diff = (pos2["lon"] - pos1["lon"]) * 60 * math.cos(math.radians(pos1["lat"]))

        dist = math.sqrt(lat_diff ** 2 + lon_diff ** 2)
        if dist < 0.001:
            return None

        ux = lon_diff / dist
        uy = lat_diff / dist

        v1x = pos1["gs"] * math.sin(math.radians(pos1["track"]))
        v1y = pos1["gs"] * math.cos(math.radians(pos1["track"]))
        v2x = pos2["gs"] * math.sin(math.radians(pos2["track"]))
        v2y = pos2["gs"] * math.cos(math.radians(pos2["track"]))

        rel_vx = v2x - v1x
        rel_vy = v2y - v1y

        closure = -(rel_vx * ux + rel_vy * uy)

        return round(closure, 1)

    def _update_state(
        self, icao: str, vr: Optional[int], alt: Optional[int],
        lat: Optional[float], lon: Optional[float],
        gs: Optional[float], track: Optional[float], now: float
    ):
        """Update aircraft state history."""
        if icao not in self._aircraft_state:
            self._aircraft_state[icao] = {
                "vs_history": [],
                "alt_history": [],
                "last_update": now
            }

        state = self._aircraft_state[icao]
        state["last_update"] = now

        if vr is not None:
            state["vs_history"].append((now, vr))
            if len(state["vs_history"]) > 10:
                state["vs_history"] = state["vs_history"][-10:]

        if alt is not None:
            state["alt_history"].append((now, alt))
            if len(state["alt_history"]) > 10:
                state["alt_history"] = state["alt_history"][-10:]

        state["lat"] = lat
        state["lon"] = lon
        state["gs"] = gs
        state["track"] = track

    def update_aircraft(self, aircraft_list: List[dict]) -> List[dict]:
        """Process aircraft list and detect safety events."""
        if not self.enabled:
            return []

        self._cleanup_old_state()
        events = []
        now = time.time()

        current_positions = {}

        for ac in aircraft_list:
            icao = ac.get("hex", "").upper()
            if not icao:
                continue

            lat = ac.get("lat")
            lon = ac.get("lon")
            alt = safe_int_altitude(ac.get("alt_baro") or ac.get("alt")) or safe_int_altitude(ac.get("alt_geom"))
            vr = ac.get("baro_rate") or ac.get("geom_rate") or ac.get("vr")
            gs = ac.get("gs")
            track = ac.get("track")
            callsign = (ac.get("flight") or "").strip()
            squawk = ac.get("squawk", "")

            # Only include in proximity check if airborne (>500ft) with valid position
            if is_valid_position(lat, lon) and alt is not None and alt >= 500:
                current_positions[icao] = {
                    "lat": lat, "lon": lon, "alt": alt,
                    "vr": vr, "gs": gs, "track": track,
                    "callsign": callsign, "raw": ac
                }

            # Check for emergency squawks
            emergency_events = self._check_emergency_squawk(icao, callsign, squawk, ac)
            events.extend(emergency_events)

            # Check for VS-related events
            vs_events = self._check_vertical_speed_events(icao, callsign, vr, alt, ac, now)
            events.extend(vs_events)

            self._update_state(icao, vr, alt, lat, lon, gs, track, now)

        # Check for proximity conflicts
        proximity_events = self._check_proximity_conflicts(current_positions)
        events.extend(proximity_events)

        # Store all events and return with IDs
        stored_events = []
        for e in events:
            stored = self._store_event(e)
            stored_events.append(stored)
            self._store_and_broadcast_event(e)

        return stored_events

    def _check_emergency_squawk(
        self, icao: str, callsign: str, squawk: str, ac: dict
    ) -> List[dict]:
        """Check for emergency squawk codes."""
        events = []

        if not squawk or squawk not in EMERGENCY_SQUAWKS:
            return events

        squawk_info = EMERGENCY_SQUAWKS[squawk]
        display_name = callsign or icao

        # Emergency squawks don't use cooldown - they persist while active
        events.append({
            "event_type": f"squawk_{squawk_info['type']}",
            "severity": squawk_info["severity"],
            "icao": icao,
            "icao_hex": icao,
            "callsign": display_name,
            "flight": display_name,
            "squawk": squawk,
            "message": f"{squawk_info['label']}: {display_name} squawking {squawk}",
            "details": {
                "squawk": squawk,
                "squawk_type": squawk_info["type"],
                "squawk_label": squawk_info["label"],
                "altitude": ac.get("alt_baro") or ac.get("alt_geom") or ac.get("alt"),
                "lat": ac.get("lat"),
                "lon": ac.get("lon"),
                "gs": ac.get("gs"),
                "track": ac.get("track"),
                "vr": ac.get("baro_rate") or ac.get("geom_rate") or ac.get("vr")
            },
            "aircraft_snapshot": self._build_aircraft_snapshot(ac),
        })

        return events

    def _check_vertical_speed_events(
        self, icao: str, callsign: str,
        current_vs: Optional[int], alt: Optional[int],
        ac: dict, now: float
    ) -> List[dict]:
        """Check for VS-related safety events."""
        events = []

        if current_vs is None:
            return events

        abs_vs = abs(current_vs)
        display_name = callsign or icao

        # Extreme vertical speed (threshold is 6000 fpm)
        if abs_vs >= self.vs_extreme_threshold:
            if self._can_trigger_event("extreme_vs", icao):
                direction = "climbing" if current_vs > 0 else "descending"

                if abs_vs >= 8000:
                    severity = "critical"
                elif abs_vs >= 7000:
                    severity = "warning"
                else:
                    severity = "low"

                events.append({
                    "event_type": "extreme_vs",
                    "severity": severity,
                    "icao": icao,
                    "icao_hex": icao,
                    "callsign": display_name,
                    "flight": display_name,
                    "message": f"Extreme vertical speed: {display_name} {direction} at {abs_vs} fpm",
                    "details": {
                        "vertical_rate": current_vs,
                        "altitude": alt,
                        "threshold": self.vs_extreme_threshold,
                        "lat": ac.get("lat"),
                        "lon": ac.get("lon"),
                        "gs": ac.get("gs"),
                        "squawk": ac.get("squawk")
                    },
                    "aircraft_snapshot": self._build_aircraft_snapshot(ac),
                })
                self._mark_event_triggered("extreme_vs", icao)

        # VS reversal detection (potential TCAS RA)
        state = self._aircraft_state.get(icao)
        if state and len(state.get("vs_history", [])) >= 2:
            vs_history = state["vs_history"]

            # Look for VS from ~4 seconds ago
            target_time = now - 4
            prev_vs = None
            for t, v in reversed(vs_history[:-1]):
                if t <= target_time:
                    prev_vs = v
                    break

            if prev_vs is None and len(vs_history) >= 2:
                prev_vs = vs_history[-2][1]

            if prev_vs is not None:
                # Check for sign change (reversal)
                is_sign_change = prev_vs * current_vs < 0

                if is_sign_change:
                    abs_change = abs(current_vs - prev_vs)

                    # Skip VS reversals during takeoff
                    is_takeoff = alt is not None and alt < 3000 and current_vs > 0

                    # TCAS RA: High magnitude reversal
                    is_tcas_ra = not is_takeoff and (
                        abs(prev_vs) >= self.tcas_vs_threshold and
                        abs(current_vs) >= self.tcas_vs_threshold
                    )

                    if is_tcas_ra and self._can_trigger_event("tcas_ra", icao):
                        msg = (f"TCAS RA suspected: {display_name} "
                               f"VS reversed from {prev_vs:+d} to {current_vs:+d} fpm")
                        events.append({
                            "event_type": "tcas_ra",
                            "severity": "critical",
                            "icao": icao,
                            "icao_hex": icao,
                            "callsign": display_name,
                            "flight": display_name,
                            "message": msg,
                            "details": {
                                "previous_vs": prev_vs,
                                "current_vs": current_vs,
                                "vs_change": current_vs - prev_vs,
                                "altitude": alt,
                                "lat": ac.get("lat"),
                                "lon": ac.get("lon"),
                                "gs": ac.get("gs"),
                                "squawk": ac.get("squawk"),
                                "threshold": self.tcas_vs_threshold
                            },
                            "aircraft_snapshot": self._build_aircraft_snapshot(ac),
                        })
                        self._mark_event_triggered("tcas_ra", icao)

                    elif not is_takeoff and abs_change >= self.vs_change_threshold:
                        # Regular VS reversal
                        if abs_change >= 4000:
                            severity = "warning"
                        else:
                            severity = "low"

                        if self._can_trigger_event("vs_reversal", icao):
                            msg = f"VS reversal: {display_name} {prev_vs:+d} → {current_vs:+d} fpm"
                            events.append({
                                "event_type": "vs_reversal",
                                "severity": severity,
                                "icao": icao,
                                "icao_hex": icao,
                                "callsign": display_name,
                                "flight": display_name,
                                "message": msg,
                                "details": {
                                    "previous_vs": prev_vs,
                                    "current_vs": current_vs,
                                    "vs_change": current_vs - prev_vs,
                                    "altitude": alt,
                                    "lat": ac.get("lat"),
                                    "lon": ac.get("lon"),
                                    "gs": ac.get("gs"),
                                    "squawk": ac.get("squawk"),
                                    "threshold": self.vs_change_threshold
                                },
                                "aircraft_snapshot": self._build_aircraft_snapshot(ac),
                            })
                            self._mark_event_triggered("vs_reversal", icao)

        return events

    def _check_proximity_conflicts(self, positions: Dict[str, dict]) -> List[dict]:
        """Check for proximity conflicts between aircraft pairs."""
        events = []
        icao_list = list(positions.keys())

        # Pre-calculate bounding box threshold in degrees
        deg_threshold = (self.proximity_nm / 60.0) * 2.0

        for i, icao1 in enumerate(icao_list):
            pos1 = positions[icao1]
            for icao2 in icao_list[i + 1:]:
                pos2 = positions[icao2]

                # Fast bounding box check
                lat_diff = abs(pos1["lat"] - pos2["lat"])
                if lat_diff > deg_threshold:
                    continue
                lon_diff = abs(pos1["lon"] - pos2["lon"])
                if lon_diff > deg_threshold:
                    continue

                dist_nm = calculate_distance_nm(
                    pos1["lat"], pos1["lon"],
                    pos2["lat"], pos2["lon"]
                )

                if dist_nm > self.proximity_nm:
                    continue

                alt_diff = abs(pos1["alt"] - pos2["alt"])
                if alt_diff > self.altitude_diff_ft:
                    continue

                # Skip takeoff/landing pairs at major airports
                if self._is_takeoff_landing_pair(pos1, pos2):
                    continue

                closure_rate = self._calculate_closure_rate(pos1, pos2)

                # Skip if aircraft are diverging
                if dist_nm > 0.5 and closure_rate is not None and closure_rate <= 0:
                    continue

                # Check track difference for passed aircraft
                if dist_nm > 0.5 and pos1["track"] is not None and pos2["track"] is not None:
                    track_diff = abs(pos1["track"] - pos2["track"])
                    if track_diff > 180:
                        track_diff = 360 - track_diff
                    if track_diff > 150:
                        continue

                if self._can_trigger_event("proximity_conflict", icao1, icao2):
                    # Severity levels
                    if dist_nm < 0.25 and alt_diff < 300:
                        severity = "critical"
                    elif dist_nm < 0.35 or alt_diff < 400:
                        severity = "warning"
                    else:
                        severity = "low"

                    display1 = pos1["callsign"] or icao1
                    display2 = pos2["callsign"] or icao2
                    msg = (
                        f"Proximity conflict: {display1} and "
                        f"{display2} within {dist_nm:.2f}nm, "
                        f"{alt_diff}ft altitude separation"
                    )

                    if closure_rate is not None and closure_rate > 0:
                        msg += f", closure rate {closure_rate:.0f}kt"

                    events.append({
                        "event_type": "proximity_conflict",
                        "severity": severity,
                        "icao": icao1,
                        "icao_hex": icao1,
                        "icao_2": icao2,
                        "icao_hex_2": icao2,
                        "callsign": display1,
                        "callsign_2": display2,
                        "flight": display1,
                        "flight_2": display2,
                        "message": msg,
                        "details": {
                            "distance_nm": round(dist_nm, 3),
                            "altitude_diff_ft": alt_diff,
                            "closure_rate_kt": closure_rate,
                            "horizontal_nm": round(dist_nm, 3),
                            "vertical_ft": alt_diff,
                            "aircraft_1": {
                                "icao": icao1,
                                "callsign": display1,
                                "lat": pos1["lat"],
                                "lon": pos1["lon"],
                                "alt": pos1["alt"],
                                "gs": pos1["gs"],
                                "track": pos1["track"],
                                "vr": pos1["vr"]
                            },
                            "aircraft_2": {
                                "icao": icao2,
                                "callsign": display2,
                                "lat": pos2["lat"],
                                "lon": pos2["lon"],
                                "alt": pos2["alt"],
                                "gs": pos2["gs"],
                                "track": pos2["track"],
                                "vr": pos2["vr"]
                            }
                        },
                        "aircraft_snapshot": self._build_aircraft_snapshot(pos1["raw"]),
                        "aircraft_snapshot_2": self._build_aircraft_snapshot(pos2["raw"]),
                    })
                    self._mark_event_triggered("proximity_conflict", icao1, icao2)

        return events

    def _broadcast_event(self, event_type: str, event: dict):
        """Broadcast event to WebSocket clients."""
        try:
            channel_layer = get_channel_layer()
            sync_group_send(
                channel_layer,
                'safety_events',
                {
                    'type': event_type,
                    'data': {
                        **event,
                        'timestamp': timezone.now().isoformat().replace('+00:00', 'Z')
                    }
                }
            )
        except Exception as e:
            logger.warning(f"Failed to broadcast {event_type}: {e}")

    def _store_and_broadcast_event(self, event: dict):
        """Store event in database and broadcast to clients."""
        # Store in database
        try:
            db_event = SafetyEvent.objects.create(
                event_type=event['event_type'],
                severity=event['severity'],
                icao_hex=event.get('icao') or event.get('icao_hex'),
                icao_hex_2=event.get('icao_2') or event.get('icao_hex_2'),
                callsign=event.get('callsign'),
                callsign_2=event.get('callsign_2'),
                message=event.get('message'),
                details=event.get('details'),
                aircraft_snapshot=event.get('aircraft_snapshot'),
                aircraft_snapshot_2=event.get('aircraft_snapshot_2'),
            )
            # Store DB ID back in active event
            event_id = event.get('id')
            if event_id and event_id in self._active_events:
                self._active_events[event_id]['db_id'] = db_event.id
        except Exception as e:
            logger.error(f"Failed to store safety event: {e}")

        # Broadcast new event to WebSocket clients
        self._broadcast_event('safety_event', event)

    def broadcast_event_updated(self, event: dict):
        """Broadcast an event update (e.g., acknowledgment change)."""
        self._broadcast_event('safety_event_updated', event)

    def broadcast_event_resolved(self, event: dict):
        """Broadcast an event resolution/clearing."""
        self._broadcast_event('safety_event_resolved', event)

    def get_stats(self) -> dict:
        """Get safety monitor statistics."""
        active_count = len(self._active_events)
        acked_count = len(self._acknowledged_events)
        unacked_count = active_count - acked_count

        # Count by severity
        severity_counts = {"critical": 0, "warning": 0, "low": 0}
        for event in self._active_events.values():
            sev = event.get("severity", "low")
            if sev in severity_counts:
                severity_counts[sev] += 1

        return {
            "tracked_aircraft": len(self._aircraft_state),
            "active_cooldowns": len(self._event_cooldown),
            "monitoring_enabled": self.enabled,
            "active_events": active_count,
            "acknowledged_events": acked_count,
            "unacknowledged_events": unacked_count,
            "events_by_severity": severity_counts,
            "thresholds": self.get_thresholds()
        }

    def get_thresholds(self) -> dict:
        """Get current threshold values."""
        return {
            "vs_change": self.vs_change_threshold,
            "vs_extreme": self.vs_extreme_threshold,
            "proximity_nm": self.proximity_nm,
            "altitude_diff_ft": self.altitude_diff_ft,
            "tcas_vs_threshold": self.tcas_vs_threshold,
            "closure_rate_kt": self.closure_rate_kt,
        }

    def get_state(self) -> dict:
        """Get current monitor state."""
        return {
            "tracked_aircraft": len(self._aircraft_state),
            "active_cooldowns": len(self._event_cooldown),
            "active_events": len(self._active_events),
        }

    def generate_test_events(self) -> List[dict]:
        """Generate test events for all safety event types."""
        now = time.time()
        test_events = []

        feeder_lat = getattr(settings, 'FEEDER_LAT', 47.9377)
        feeder_lon = getattr(settings, 'FEEDER_LON', -121.9687)

        # Test emergency squawk (7700)
        test_events.append({
            "event_type": "squawk_emergency",
            "severity": "critical",
            "icao": "TEST01",
            "icao_hex": "TEST01",
            "callsign": "TEST001",
            "flight": "TEST001",
            "message": "EMERGENCY: TEST001 squawking 7700",
            "details": {
                "squawk": "7700",
                "squawk_type": "emergency",
                "altitude": 5000,
                "lat": feeder_lat,
                "lon": feeder_lon,
            },
            "aircraft_snapshot": {
                "hex": "TEST01",
                "flight": "TEST001",
                "lat": feeder_lat,
                "lon": feeder_lon,
                "alt_baro": 5000,
                "gs": 250,
                "track": 90,
                "baro_rate": 0,
                "squawk": "7700",
            },
        })

        # Test TCAS RA
        test_events.append({
            "event_type": "tcas_ra",
            "severity": "critical",
            "icao": "TEST02",
            "icao_hex": "TEST02",
            "callsign": "TEST002",
            "flight": "TEST002",
            "message": "TCAS RA suspected: TEST002 VS reversed from -2500 to +2500 fpm",
            "details": {
                "previous_vs": -2500,
                "current_vs": 2500,
                "vs_change": 5000,
                "altitude": 8000,
                "lat": feeder_lat + 0.01,
                "lon": feeder_lon + 0.01,
            },
            "aircraft_snapshot": {
                "hex": "TEST02",
                "flight": "TEST002",
                "lat": feeder_lat + 0.01,
                "lon": feeder_lon + 0.01,
                "alt_baro": 8000,
                "gs": 300,
                "track": 180,
                "baro_rate": 2500,
                "squawk": "1200",
            },
        })

        # Test VS reversal (warning level)
        test_events.append({
            "event_type": "vs_reversal",
            "severity": "warning",
            "icao": "TEST03",
            "icao_hex": "TEST03",
            "callsign": "TEST003",
            "flight": "TEST003",
            "message": "VS reversal: TEST003 -3000 → +1500 fpm",
            "details": {
                "previous_vs": -3000,
                "current_vs": 1500,
                "vs_change": 4500,
                "altitude": 12000,
                "lat": feeder_lat - 0.01,
                "lon": feeder_lon - 0.01,
            },
            "aircraft_snapshot": {
                "hex": "TEST03",
                "flight": "TEST003",
                "lat": feeder_lat - 0.01,
                "lon": feeder_lon - 0.01,
                "alt_baro": 12000,
                "gs": 350,
                "track": 270,
                "baro_rate": 1500,
                "squawk": "4521",
            },
        })

        # Test extreme VS
        test_events.append({
            "event_type": "extreme_vs",
            "severity": "low",
            "icao": "TEST04",
            "icao_hex": "TEST04",
            "callsign": "TEST004",
            "flight": "TEST004",
            "message": "Extreme vertical speed: TEST004 descending at 6500 fpm",
            "details": {
                "vertical_rate": -6500,
                "altitude": 3000,
                "threshold": self.vs_extreme_threshold,
                "lat": feeder_lat + 0.02,
                "lon": feeder_lon - 0.02,
            },
            "aircraft_snapshot": {
                "hex": "TEST04",
                "flight": "TEST004",
                "lat": feeder_lat + 0.02,
                "lon": feeder_lon - 0.02,
                "alt_baro": 3000,
                "gs": 180,
                "track": 45,
                "baro_rate": -6500,
                "squawk": "1200",
            },
        })

        # Test proximity conflict
        test_events.append({
            "event_type": "proximity_conflict",
            "severity": "warning",
            "icao": "TEST05",
            "icao_hex": "TEST05",
            "icao_2": "TEST06",
            "icao_hex_2": "TEST06",
            "callsign": "TEST005",
            "callsign_2": "TEST006",
            "flight": "TEST005",
            "flight_2": "TEST006",
            "message": "Proximity conflict: TEST005 and TEST006 within 0.80nm, 400ft altitude separation",
            "details": {
                "distance_nm": 0.8,
                "altitude_diff_ft": 400,
                "closure_rate_kt": 150,
                "aircraft_1": {
                    "icao": "TEST05",
                    "callsign": "TEST005",
                    "lat": feeder_lat,
                    "lon": feeder_lon,
                    "alt": 10000,
                    "gs": 280,
                    "track": 90,
                },
                "aircraft_2": {
                    "icao": "TEST06",
                    "callsign": "TEST006",
                    "lat": feeder_lat + 0.005,
                    "lon": feeder_lon + 0.005,
                    "alt": 10400,
                    "gs": 290,
                    "track": 270,
                },
            },
            "aircraft_snapshot": {
                "hex": "TEST05",
                "flight": "TEST005",
                "lat": feeder_lat,
                "lon": feeder_lon,
                "alt_baro": 10000,
                "gs": 280,
                "track": 90,
                "baro_rate": 0,
                "squawk": "3456",
            },
            "aircraft_snapshot_2": {
                "hex": "TEST06",
                "flight": "TEST006",
                "lat": feeder_lat + 0.005,
                "lon": feeder_lon + 0.005,
                "alt_baro": 10400,
                "gs": 290,
                "track": 270,
                "baro_rate": 0,
                "squawk": "7654",
            },
        })

        # Add all test events to active events
        for event in test_events:
            event_id = f"test_{event['event_type']}:{event['icao']}:{uuid.uuid4().hex[:8]}"
            event["id"] = event_id
            event["created_at"] = now
            event["last_seen"] = now
            event["acknowledged"] = False
            event["is_test"] = True
            self._active_events[event_id] = event

        logger.info(f"Generated {len(test_events)} test safety events")
        return test_events


# Global safety monitor instance
safety_monitor = SafetyMonitor()
