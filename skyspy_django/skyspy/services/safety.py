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
import threading
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import DatabaseError, InterfaceError
from django.utils import timezone

from skyspy.models import SafetyEvent

logger = logging.getLogger(__name__)

# Emergency squawk codes and their meanings
EMERGENCY_SQUAWKS = {
    "7500": {"type": "hijack", "label": "HIJACK", "severity": "critical"},
    "7600": {"type": "radio_failure", "label": "RADIO FAILURE", "severity": "warning"},
    "7700": {"type": "emergency", "label": "EMERGENCY", "severity": "critical"},
}

# Major airport locations for takeoff/landing filtering (Class B and C)
# Format: (icao, lat, lon, field_elevation_ft) — elevation is needed to gate
# the takeoff/landing suppression on height above ground, not MSL.
MAJOR_AIRPORTS = [
    # Class B
    ("KATL", 33.6367, -84.4281, 1026),
    ("KBOS", 42.3656, -71.0096, 20),
    ("KORD", 41.9742, -87.9073, 672),
    ("KDFW", 32.8998, -97.0403, 607),
    ("KDEN", 39.8561, -104.6737, 5434),
    ("KDTW", 42.2124, -83.3534, 645),
    ("KEWR", 40.6895, -74.1745, 18),
    ("KIAH", 29.9902, -95.3368, 97),
    ("KJFK", 40.6413, -73.7781, 13),
    ("KLAS", 36.0840, -115.1537, 2181),
    ("KLAX", 33.9416, -118.4085, 128),
    ("KMCO", 28.4312, -81.3081, 96),
    ("KMIA", 25.7959, -80.2870, 8),
    ("KMSP", 44.8848, -93.2223, 841),
    ("KPHL", 39.8729, -75.2437, 36),
    ("KPHX", 33.4373, -112.0078, 1135),
    ("KSEA", 47.4502, -122.3088, 433),
    ("KSFO", 37.6213, -122.3790, 13),
    ("KSLC", 40.7899, -111.9791, 4227),
    ("KTPA", 27.9755, -82.5332, 26),
    # Class C (sample)
    ("KAUS", 30.1975, -97.6664, 542),
    ("KBNA", 36.1245, -86.6782, 599),
    ("KBUF", 42.9405, -78.7322, 728),
    ("KCLE", 41.4117, -81.8498, 791),
    ("KCLT", 35.2140, -80.9431, 748),
    ("KCVG", 39.0488, -84.6678, 896),
    ("KHOU", 29.6454, -95.2789, 46),
    ("KIND", 39.7173, -86.2944, 797),
    ("KMCI", 39.2976, -94.7139, 1026),
    ("KMEM", 35.0424, -89.9767, 341),
    ("KMKE", 42.9472, -87.8966, 723),
    ("KMSY", 29.9934, -90.2580, 4),
    ("KOAK", 37.7213, -122.2208, 9),
    ("KOMA", 41.3032, -95.8941, 984),
    ("KONT", 34.0560, -117.6012, 944),
    ("KPDX", 45.5898, -122.5951, 31),
    ("KPIT", 40.4915, -80.2329, 1203),
    ("KRDU", 35.8776, -78.7875, 435),
    ("KSAN", 32.7336, -117.1897, 17),
    ("KSAT", 29.5337, -98.4698, 809),
    ("KSJC", 37.3626, -121.9291, 62),
    ("KSMF", 38.6954, -121.5908, 27),
    ("KSTL", 38.7487, -90.3700, 618),
]

# Severity ordering used for escalation checks ("info" is a legacy value)
SEVERITY_RANK = {"info": 0, "low": 0, "warning": 1, "critical": 2}


def first_present(*values):
    """Return the first value that is not None. Unlike `a or b`, a valid 0
    (e.g. baro_rate=0 fpm in level flight) is NOT treated as missing."""
    for v in values:
        if v is not None:
            return v
    return None


def wrap_lon_diff(dlon: float) -> float:
    """Normalize a longitude difference to [-180, 180] (antimeridian wrap)."""
    return (dlon + 180.0) % 360.0 - 180.0


def calculate_distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in nautical miles using haversine formula."""
    R = 3440.065  # Earth radius in NM
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_valid_position(lat: float | None, lon: float | None) -> bool:
    """Check if position coordinates are valid."""
    if lat is None or lon is None:
        return False
    return -90 <= lat <= 90 and -180 <= lon <= 180


def safe_int_altitude(alt) -> int | None:
    """Safely convert altitude to int, handling 'ground' and other special values."""
    if alt is None:
        return None
    if isinstance(alt, str):
        if alt.lower() == "ground":
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
    POSITION_STALE_SEC = 15  # ignore positions not updated within this window
    CONFIG_REFRESH_SEC = 30  # how often to re-read runtime (SystemConfig) settings
    # Absolute proximity floor (nm) below which a conflict always alerts, regardless
    # of divergence — too close to ever suppress on a closure/track heuristic. Kept
    # independent of the configurable SAFETY_PROXIMITY_NM by design.
    ALWAYS_ALERT_RADIUS_NM = 0.5
    # Extra altitude tolerance (ft) applied to the separation skip gate when the two
    # aircraft report altitudes from different references (baro vs geom), which can
    # legitimately disagree by hundreds of feet. Widening errs toward NOT missing a
    # real conflict rather than silencing one on a reference mismatch.
    MIXED_ALT_SOURCE_MARGIN_FT = 250

    def __init__(self):
        # Thresholds from settings
        self.vs_change_threshold = getattr(settings, "SAFETY_VS_CHANGE_THRESHOLD", 3000)
        self.vs_extreme_threshold = getattr(settings, "SAFETY_VS_EXTREME_THRESHOLD", 6000)
        self.proximity_nm = getattr(settings, "SAFETY_PROXIMITY_NM", 1.0)
        self.altitude_diff_ft = getattr(settings, "SAFETY_ALTITUDE_DIFF_FT", 1000)
        self.closure_rate_kt = getattr(settings, "SAFETY_CLOSURE_RATE_KT", 100)
        self.tcas_vs_threshold = getattr(settings, "SAFETY_TCAS_VS_THRESHOLD", 1500)

        # State tracking
        self._aircraft_state: dict[str, dict] = {}
        self._event_cooldown: dict[str, float] = {}
        self._active_events: dict[str, dict] = {}  # event_id -> event data
        self._acknowledged_events: set[str] = set()  # Set of acknowledged event IDs
        self._events_lock = threading.Lock()  # Lock for _active_events and _acknowledged_events
        self._enabled = getattr(settings, "SAFETY_MONITORING_ENABLED", True)
        self._last_cleanup = 0.0
        self._rehydrated = False
        # First runtime-config refresh happens CONFIG_REFRESH_SEC after startup:
        # settings/env (already read above) win for short-lived instances (tests),
        # the admin SystemConfig values take over for the long-lived worker.
        self._last_config_refresh = time.time()

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
            "alt_baro": first_present(ac.get("alt_baro"), ac.get("alt")),
            "alt_geom": ac.get("alt_geom"),
            "gs": ac.get("gs"),
            "track": ac.get("track"),
            "baro_rate": first_present(ac.get("baro_rate"), ac.get("vr")),
            "geom_rate": ac.get("geom_rate"),
            "squawk": ac.get("squawk"),
            "category": ac.get("category"),
            "nav_altitude_mcp": ac.get("nav_altitude_mcp"),
            "nav_heading": ac.get("nav_heading"),
            "nav_modes": ac.get("nav_modes"),
            "emergency": ac.get("emergency"),
            "rssi": ac.get("rssi"),
        }

    def _get_cooldown_key(self, event_type: str, icao: str, icao_2: str | None = None) -> str:
        """Generate a cooldown key for an event."""
        if icao_2:
            # Ensure both values are not None before sorting
            if icao is None or icao_2 is None:
                return f"{event_type}:{icao or ''}:{icao_2 or ''}"
            pair = tuple(sorted([icao, icao_2]))
            return f"{event_type}:{pair[0]}:{pair[1]}"
        return f"{event_type}:{icao}"

    def _can_trigger_event(self, event_type: str, icao: str, icao_2: str | None = None) -> bool:
        """Check if we can trigger an event (respects cooldown)."""
        if icao is None:
            return False
        key = self._get_cooldown_key(event_type, icao, icao_2)
        now = time.time()
        last_trigger = self._event_cooldown.get(key, 0)
        return (now - last_trigger) > self.EVENT_COOLDOWN

    def _mark_event_triggered(self, event_type: str, icao: str, icao_2: str | None = None):
        """Mark an event as triggered."""
        key = self._get_cooldown_key(event_type, icao, icao_2)
        self._event_cooldown[key] = time.time()

    def _is_severity_escalation(self, event_type: str, icao: str, icao_2: str | None, new_severity: str) -> bool:
        """True if an active event of this key exists with lower severity.

        Used to bypass the trigger cooldown: a worsening situation (e.g. a
        proximity conflict converging from 'low' to 'critical') must not be
        silenced by the cooldown from its own initial detection.
        """
        event_id = self._generate_event_id(event_type, icao, icao_2)
        with self._events_lock:
            existing = self._active_events.get(event_id)
            if not existing:
                return False
            return SEVERITY_RANK.get(new_severity, 0) > SEVERITY_RANK.get(existing.get("severity"), 0)

    def _cleanup_old_state(self):
        """Remove state older than retention period and expired events."""
        now = time.time()

        # Only cleanup every 5 seconds to reduce overhead
        if now - self._last_cleanup < 5.0:
            return
        self._last_cleanup = now

        cutoff = now - self.HISTORY_RETENTION
        cooldown_cutoff = now - self.EVENT_COOLDOWN
        event_cutoff = now - self.EVENT_EXPIRY

        # Clean up old aircraft state
        to_remove = [icao for icao, state in self._aircraft_state.items() if state.get("last_update", 0) < cutoff]
        for icao in to_remove:
            del self._aircraft_state[icao]

        # Clean up expired cooldowns (must use EVENT_COOLDOWN as the cutoff so
        # entries survive for the full cooldown period and remain enforceable)
        old_cooldowns = [k for k, v in self._event_cooldown.items() if v < cooldown_cutoff]
        for k in old_cooldowns:
            del self._event_cooldown[k]

        # Pick up acknowledgments written to the DB by the web process (the
        # REST/socket ack paths run in a different container than detection)
        self._sync_acks_from_db()

        # Clean up expired events (with lock for thread safety)
        with self._events_lock:
            expired_events = [
                (eid, event) for eid, event in self._active_events.items() if event.get("last_seen", 0) < event_cutoff
            ]
            for eid, _event in expired_events:
                del self._active_events[eid]
                self._acknowledged_events.discard(eid)

        # Broadcast event resolution for expired events (outside lock to avoid deadlock)
        for _eid, event in expired_events:
            self.broadcast_event_resolved(event)

        # Publish monitor stats for the web process (API/socket status endpoints
        # run in a different container whose monitor never tracks aircraft)
        try:
            from django.core.cache import cache

            cache.set("safety:monitor_stats", self.get_stats(), 60)
        except Exception:  # broad: stats publishing must never crash the safety loop
            logger.debug("Failed to publish safety monitor stats to cache", exc_info=True)

    def _sync_acks_from_db(self):
        """Apply DB-side acknowledgments to in-memory active events.

        One-way (DB acked -> memory acked) on purpose: memory-only acks for
        events without a db_id would otherwise be reverted every cycle.
        """
        with self._events_lock:
            id_map = {
                e["db_id"]: eid
                for eid, e in self._active_events.items()
                if e.get("db_id") and not e.get("acknowledged")
            }
        if not id_map:
            return
        try:
            acked_ids = list(
                SafetyEvent.objects.filter(id__in=id_map.keys(), acknowledged=True).values_list("id", flat=True)
            )
        except (DatabaseError, InterfaceError) as e:
            logger.warning(f"Failed to sync safety acks from DB: {type(e).__name__}: {e}")
            return
        with self._events_lock:
            for db_id in acked_ids:
                eid = id_map.get(db_id)
                event = self._active_events.get(eid)
                if event is not None:
                    event["acknowledged"] = True
                    self._acknowledged_events.add(eid)

    def _refresh_runtime_config(self, now: float):
        """Re-read runtime-editable settings (admin SystemConfig) periodically.

        get_db_config keeps env-var precedence, so environment configuration
        still wins; this makes admin UI changes take effect without a restart.
        """
        if now - self._last_config_refresh < self.CONFIG_REFRESH_SEC:
            return
        self._last_config_refresh = now
        from skyspy.settings import get_db_config

        self._enabled = get_db_config("safety.monitoring_enabled", self._enabled, bool)
        self.vs_change_threshold = get_db_config("safety.vs_change_threshold", self.vs_change_threshold, int)
        self.vs_extreme_threshold = get_db_config("safety.vs_extreme_threshold", self.vs_extreme_threshold, int)
        self.proximity_nm = get_db_config("safety.proximity_nm", self.proximity_nm, float)
        self.altitude_diff_ft = get_db_config("safety.altitude_diff_ft", self.altitude_diff_ft, int)
        self.closure_rate_kt = get_db_config("safety.closure_rate_kt", self.closure_rate_kt, float)
        self.tcas_vs_threshold = get_db_config("safety.tcas_vs_threshold", self.tcas_vs_threshold, int)

    def _rehydrate_active_events(self):
        """Reload recent events from the DB into the active set after a restart.

        Without this, a worker restart mid-emergency forgets all active events:
        ongoing conditions get re-detected as duplicate DB rows/broadcasts and
        already-ended ones never emit safety:event_resolved.
        """
        if self._rehydrated:
            return
        self._rehydrated = True
        try:
            cutoff = timezone.now() - timedelta(seconds=self.EVENT_EXPIRY)
            rows = list(SafetyEvent.objects.filter(timestamp__gte=cutoff))
        except (DatabaseError, InterfaceError) as e:
            logger.warning(f"Failed to rehydrate safety events: {type(e).__name__}: {e}")
            return
        with self._events_lock:
            for row in rows:
                event_id = self._generate_event_id(row.event_type, row.icao_hex, row.icao_hex_2 or None)
                if event_id in self._active_events:
                    continue
                ts = row.timestamp.timestamp()
                self._active_events[event_id] = {
                    "id": event_id,
                    "db_id": row.id,
                    "event_type": row.event_type,
                    "severity": row.severity,
                    "icao": row.icao_hex,
                    "icao_hex": row.icao_hex,
                    "icao_2": row.icao_hex_2,
                    "icao_hex_2": row.icao_hex_2,
                    "callsign": row.callsign,
                    "callsign_2": row.callsign_2,
                    "message": row.message,
                    "details": row.details,
                    "created_at": ts,
                    "last_seen": ts,
                    "acknowledged": row.acknowledged,
                }
                if row.acknowledged:
                    self._acknowledged_events.add(event_id)
        if rows:
            logger.info(f"Rehydrated {len(rows)} recent safety events from DB")

    def _generate_event_id(self, event_type: str, icao: str, icao_2: str | None = None) -> str:
        """Generate a stable event ID for deduplication."""
        if icao_2:
            pair = tuple(sorted([icao, icao_2]))
            return f"{event_type}:{pair[0]}:{pair[1]}"
        return f"{event_type}:{icao}"

    def _store_event(self, event: dict) -> tuple[dict, bool]:
        """
        Store an event and return (event with ID and metadata, created flag). Thread-safe.

        The created flag is True when the event was not already active, so callers
        can avoid re-persisting/re-broadcasting persistent events every cycle.
        """
        event_id = self._generate_event_id(
            event["event_type"],
            event.get("icao") or event.get("icao_hex"),
            event.get("icao_2") or event.get("icao_hex_2"),
        )
        now = time.time()

        with self._events_lock:
            # Check if event already exists
            if event_id in self._active_events:
                # Update existing event
                existing = self._active_events[event_id]
                old_severity = existing.get("severity")
                old_message = existing.get("message")
                existing.update(event)
                existing["id"] = event_id
                existing["last_seen"] = now
                existing["acknowledged"] = event_id in self._acknowledged_events
                result = existing.copy()  # Return copy to avoid race conditions
                # Flag material changes so the caller can re-broadcast/persist.
                # Squawk events re-detect identically every cycle — comparing
                # severity+message keeps those from spamming updates.
                result["_changed"] = old_severity != existing.get("severity") or old_message != existing.get("message")
                return result, False
            else:
                # New event
                event["id"] = event_id
                event["created_at"] = now
                event["last_seen"] = now
                event["acknowledged"] = False
                self._active_events[event_id] = event
                return event.copy(), True  # Return copy to avoid race conditions

    def find_event_by_db_id(self, db_id: int) -> str | None:
        """Find an active event's string ID by its database ID. Thread-safe."""
        with self._events_lock:
            for event_id, event in self._active_events.items():
                if event.get("db_id") == db_id:
                    return event_id
        return None

    def acknowledge_event(self, event_id: str) -> bool:
        """Acknowledge an event by ID. Returns True if successful. Thread-safe."""
        event_to_broadcast = None

        with self._events_lock:
            # Direct string ID match
            if event_id in self._active_events:
                self._acknowledged_events.add(event_id)
                self._active_events[event_id]["acknowledged"] = True
                event_to_broadcast = self._active_events[event_id].copy()
            else:
                # Try numeric db_id lookup
                try:
                    db_id = int(event_id)
                    for eid, event in self._active_events.items():
                        if event.get("db_id") == db_id:
                            self._acknowledged_events.add(eid)
                            event["acknowledged"] = True
                            event_to_broadcast = event.copy()
                            break
                except (ValueError, TypeError):
                    logger.debug(f"Event ID '{event_id}' is not a valid numeric ID")

        # Broadcast outside lock to avoid deadlock
        if event_to_broadcast:
            self.broadcast_event_updated(event_to_broadcast)
            return True

        return False

    def unacknowledge_event(self, event_id: str) -> bool:
        """Remove acknowledgment from an event. Returns True if successful. Thread-safe."""
        event_to_broadcast = None

        with self._events_lock:
            # Direct string ID match
            if event_id in self._active_events:
                self._acknowledged_events.discard(event_id)
                self._active_events[event_id]["acknowledged"] = False
                event_to_broadcast = self._active_events[event_id].copy()
            else:
                # Try numeric db_id lookup
                try:
                    db_id = int(event_id)
                    for eid, event in self._active_events.items():
                        if event.get("db_id") == db_id:
                            self._acknowledged_events.discard(eid)
                            event["acknowledged"] = False
                            event_to_broadcast = event.copy()
                            break
                except (ValueError, TypeError):
                    logger.debug(f"Event ID '{event_id}' is not a valid numeric ID for unacknowledge")

        # Broadcast outside lock to avoid deadlock
        if event_to_broadcast:
            self.broadcast_event_updated(event_to_broadcast)
            return True

        return False

    def get_active_events(self, include_acknowledged: bool = True) -> list[dict]:
        """Get all active safety events. Thread-safe."""
        with self._events_lock:
            events = [e.copy() for e in self._active_events.values()]
        if not include_acknowledged:
            events = [e for e in events if not e.get("acknowledged", False)]
        return events

    def clear_event(self, event_id: str) -> bool:
        """Remove an event entirely. Returns True if successful. Thread-safe."""
        event_to_broadcast = None

        with self._events_lock:
            # Direct string ID match
            if event_id in self._active_events:
                event_to_broadcast = self._active_events[event_id].copy()
                del self._active_events[event_id]
                self._acknowledged_events.discard(event_id)
            else:
                # Try numeric db_id lookup
                try:
                    db_id = int(event_id)
                    for eid, event in list(self._active_events.items()):
                        if event.get("db_id") == db_id:
                            event_to_broadcast = event.copy()
                            del self._active_events[eid]
                            self._acknowledged_events.discard(eid)
                            break
                except (ValueError, TypeError):
                    logger.debug(f"Event ID '{event_id}' is not a valid numeric ID for clear")

        # Broadcast outside lock to avoid deadlock
        if event_to_broadcast:
            self.broadcast_event_resolved(event_to_broadcast)
            return True

        return False

    def clear_all_events(self):
        """Clear all active events and acknowledgments. Thread-safe."""
        with self._events_lock:
            self._active_events.clear()
            self._acknowledged_events.clear()

    def _nearest_major_airport(self, lat: float, lon: float, radius_nm: float = 5.0) -> tuple | None:
        """Return the closest MAJOR_AIRPORTS entry within radius, or None."""
        best = None
        best_dist = radius_nm
        for airport in MAJOR_AIRPORTS:
            dist = calculate_distance_nm(lat, lon, airport[1], airport[2])
            if dist <= best_dist:
                best = airport
                best_dist = dist
        return best

    def _is_near_major_airport(self, lat: float, lon: float, radius_nm: float = 5.0) -> bool:
        """Check if a position is within radius of a major airport."""
        return self._nearest_major_airport(lat, lon, radius_nm) is not None

    def _is_takeoff_landing_pair(self, pos1: dict, pos2: dict) -> bool:
        """
        Check if two aircraft appear to be a takeoff/landing pair at an airport.

        Returns True if:
        - Both are near a major airport (within 5nm)
        - Both are at low height above the field (<3000ft AGL)
        - One is climbing (positive VS) and one is descending (negative VS)
        """
        # Both must be near a major airport
        apt1 = self._nearest_major_airport(pos1["lat"], pos1["lon"])
        apt2 = self._nearest_major_airport(pos2["lat"], pos2["lon"])
        if apt1 is None or apt2 is None:
            return False

        # Both must be low above the field. Altitudes are barometric MSL, so
        # compare against field elevation — a fixed MSL gate would never match
        # at high-elevation airports (KDEN 5,434ft, KSLC 4,227ft).
        if (pos1["alt"] - apt1[3]) > 3000 or (pos2["alt"] - apt2[3]) > 3000:
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
        return abs(vr1) >= 300 or abs(vr2) >= 300

    def _calculate_closure_rate(self, pos1: dict, pos2: dict) -> float | None:
        """Calculate closure rate between two aircraft in knots."""
        if pos1["gs"] is None or pos2["gs"] is None:
            return None
        if pos1["track"] is None or pos2["track"] is None:
            return None

        lat_diff = (pos2["lat"] - pos1["lat"]) * 60
        lon_diff = wrap_lon_diff(pos2["lon"] - pos1["lon"]) * 60 * math.cos(math.radians(pos1["lat"]))

        dist = math.sqrt(lat_diff**2 + lon_diff**2)
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

    @staticmethod
    def _calculate_cpa(pos1: dict, pos2: dict) -> dict | None:
        """
        Calculate Closest Point of Approach between two aircraft.

        Uses current position, track, and ground speed to predict
        when and where the aircraft will be closest.

        Returns dict with cpa_distance_nm, cpa_time_seconds, cpa_lat, cpa_lon
        or None if calculation isn't possible.
        """
        if pos1["gs"] is None or pos2["gs"] is None:
            return None
        if pos1["track"] is None or pos2["track"] is None:
            return None

        # Relative position in nautical miles
        avg_lat = (pos1["lat"] + pos2["lat"]) / 2
        dx = wrap_lon_diff(pos2["lon"] - pos1["lon"]) * 60 * math.cos(math.radians(avg_lat))
        dy = (pos2["lat"] - pos1["lat"]) * 60

        # Velocity components in nm/hour (East/North)
        track1 = math.radians(pos1["track"])
        track2 = math.radians(pos2["track"])
        v1x = pos1["gs"] * math.sin(track1)
        v1y = pos1["gs"] * math.cos(track1)
        v2x = pos2["gs"] * math.sin(track2)
        v2y = pos2["gs"] * math.cos(track2)

        # Relative velocity
        dvx = v2x - v1x
        dvy = v2y - v1y

        # Magnitude squared of relative velocity
        dv_mag_sq = dvx * dvx + dvy * dvy

        # If aircraft are not moving relative to each other
        if dv_mag_sq < 0.001:
            current_dist = math.sqrt(dx * dx + dy * dy)
            mid_lat = (pos1["lat"] + pos2["lat"]) / 2
            mid_lon = (pos1["lon"] + pos2["lon"]) / 2
            return {
                "cpa_distance_nm": round(current_dist, 3),
                "cpa_time_seconds": 0,
                "cpa_lat": round(mid_lat, 6),
                "cpa_lon": round(mid_lon, 6),
            }

        # Time to CPA in hours: t = -(dx*dvx + dy*dvy) / (dvx^2 + dvy^2)
        t_cpa_hours = -(dx * dvx + dy * dvy) / dv_mag_sq
        t_cpa_seconds = t_cpa_hours * 3600

        # If CPA is in the past, aircraft are diverging
        if t_cpa_hours < 0:
            return None

        # Cap look-ahead to 5 minutes (300 seconds)
        if t_cpa_seconds > 300:
            return None

        # Calculate CPA positions
        cpa1_lat = pos1["lat"] + (v1y * t_cpa_hours) / 60
        cpa1_lon = pos1["lon"] + (v1x * t_cpa_hours) / (60 * math.cos(math.radians(pos1["lat"])))
        cpa2_lat = pos2["lat"] + (v2y * t_cpa_hours) / 60
        cpa2_lon = pos2["lon"] + (v2x * t_cpa_hours) / (60 * math.cos(math.radians(pos2["lat"])))

        # Distance at CPA
        cpa_dx = wrap_lon_diff(cpa2_lon - cpa1_lon) * 60 * math.cos(math.radians((cpa1_lat + cpa2_lat) / 2))
        cpa_dy = (cpa2_lat - cpa1_lat) * 60
        cpa_distance = math.sqrt(cpa_dx * cpa_dx + cpa_dy * cpa_dy)

        # Midpoint at CPA
        cpa_lat = (cpa1_lat + cpa2_lat) / 2
        cpa_lon = (cpa1_lon + cpa2_lon) / 2

        return {
            "cpa_distance_nm": round(cpa_distance, 3),
            "cpa_time_seconds": round(t_cpa_seconds, 1),
            "cpa_lat": round(cpa_lat, 6),
            "cpa_lon": round(cpa_lon, 6),
        }

    def _update_state(
        self,
        icao: str,
        vr: int | None,
        alt: int | None,
        lat: float | None,
        lon: float | None,
        gs: float | None,
        track: float | None,
        now: float,
    ):
        """Update aircraft state history."""
        if icao not in self._aircraft_state:
            self._aircraft_state[icao] = {"vs_history": [], "alt_history": [], "last_update": now}

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

    def update_aircraft(self, aircraft_list: list[dict]) -> list[dict]:
        """Process aircraft list and detect safety events."""
        now = time.time()
        # Refresh runtime config before the enabled check so an admin can
        # re-enable monitoring at runtime (a disabled monitor must still poll it)
        self._refresh_runtime_config(now)
        if not self.enabled:
            return []

        self._rehydrate_active_events()
        self._cleanup_old_state()
        events = []

        current_positions = {}

        for ac in aircraft_list:
            icao = ac.get("hex", "").upper()
            if not icao:
                continue

            lat = ac.get("lat")
            lon = ac.get("lon")
            raw_alt = first_present(ac.get("alt_baro"), ac.get("alt"))
            # "ground" means explicitly on-ground: don't fall through to geometric
            # altitude (MSL), which would put taxiing aircraft at high-elevation
            # airports into the airborne proximity checks.
            on_ground = isinstance(raw_alt, str) and raw_alt.lower() == "ground"
            alt = safe_int_altitude(raw_alt)
            # Track which altitude reference this value came from. Barometric and
            # geometric altitudes can differ by hundreds of feet, so a pair mixing
            # the two needs a wider separation tolerance (see _check_proximity_conflicts).
            alt_source = "baro"
            if alt is None:
                alt = safe_int_altitude(ac.get("alt_geom"))
                alt_source = "geom"
            # first_present: baro_rate=0 (level flight) is a valid reading and must
            # not fall through to the noisier geom_rate
            vr = first_present(ac.get("baro_rate"), ac.get("geom_rate"), ac.get("vr"))
            gs = ac.get("gs")
            track = ac.get("track")
            callsign = (ac.get("flight") or "").strip()
            squawk = ac.get("squawk", "")

            # Ignore stale positions: readsb keeps last-known positions for tens
            # of seconds; comparing a frozen ghost against live traffic produces
            # false proximity conflicts (and misses real ones near it)
            seen_pos = first_present(ac.get("seen_pos"), ac.get("seen"))
            stale = isinstance(seen_pos, (int, float)) and seen_pos > self.POSITION_STALE_SEC

            # Only include in proximity check if airborne (>500ft) with valid position
            if not on_ground and not stale and is_valid_position(lat, lon) and alt is not None and alt >= 500:
                current_positions[icao] = {
                    "lat": lat,
                    "lon": lon,
                    "alt": alt,
                    "alt_source": alt_source,
                    "vr": vr,
                    "gs": gs,
                    "track": track,
                    "callsign": callsign,
                    "raw": ac,
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

        # Store all events and return with IDs.
        # Persistent events (e.g. emergency squawks) are re-detected every cycle;
        # persist/broadcast them once when the condition starts, and push an
        # update (plus DB severity refresh) when a live event materially changes
        # (e.g. a proximity conflict escalating from 'low' to 'critical').
        stored_events = []
        for e in events:
            stored, created = self._store_event(e)
            changed = stored.pop("_changed", False)
            stored_events.append(stored)
            if created:
                self._store_and_broadcast_event(e)
            elif changed:
                self._update_db_event(stored)
                self.broadcast_event_updated(stored)

        return stored_events

    def _update_db_event(self, event: dict):
        """Refresh the persisted row for an active event whose severity/message changed."""
        db_id = event.get("db_id")
        if not db_id:
            return
        try:
            SafetyEvent.objects.filter(id=db_id).update(
                severity=event.get("severity"),
                message=event.get("message"),
                details=event.get("details"),
                cpa_distance_nm=event.get("cpa_distance_nm"),
                cpa_time_seconds=event.get("cpa_time_seconds"),
                cpa_lat=event.get("cpa_lat"),
                cpa_lon=event.get("cpa_lon"),
            )
        except (DatabaseError, InterfaceError) as e:
            logger.error(f"Failed to update safety event {db_id}: {type(e).__name__}: {e}")

    def _check_emergency_squawk(self, icao: str, callsign: str, squawk: str, ac: dict) -> list[dict]:
        """Check for emergency squawk codes."""
        events = []

        # Resolve any active squawk event whose code the aircraft no longer
        # transmits — otherwise a plane back on 1200 keeps its HIJACK/RADIO
        # FAILURE banner for the full EVENT_EXPIRY window.
        self._resolve_cleared_squawk_events(icao, squawk)

        if not squawk or squawk not in EMERGENCY_SQUAWKS:
            return events

        # Alert on the FIRST sighting. A transponder dialing through 75xx/76xx/
        # 77xx is a real false-positive source, but a debounce means an aircraft
        # decoded on a single cycle (edge of coverage, intermittent reception)
        # never alerts at all — a missed real emergency is strictly worse than a
        # brief false alarm, which self-resolves when the code changes.
        squawk_info = EMERGENCY_SQUAWKS[squawk]
        display_name = callsign or icao

        # Emergency squawks don't use cooldown - they persist while active
        events.append(
            {
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
                    "altitude": first_present(ac.get("alt_baro"), ac.get("alt_geom"), ac.get("alt")),
                    "lat": ac.get("lat"),
                    "lon": ac.get("lon"),
                    "gs": ac.get("gs"),
                    "track": ac.get("track"),
                    "vr": first_present(ac.get("baro_rate"), ac.get("geom_rate"), ac.get("vr")),
                },
                "aircraft_snapshot": self._build_aircraft_snapshot(ac),
            }
        )

        return events

    def _resolve_cleared_squawk_events(self, icao: str, current_squawk: str | None):
        """Resolve active emergency-squawk events for codes no longer transmitted. Thread-safe."""
        cleared = []
        with self._events_lock:
            for info in EMERGENCY_SQUAWKS.values():
                event_id = f"squawk_{info['type']}:{icao}"
                event = self._active_events.get(event_id)
                if event is not None and event.get("squawk") != current_squawk:
                    cleared.append(self._active_events.pop(event_id))
                    self._acknowledged_events.discard(event_id)
        for event in cleared:
            self.broadcast_event_resolved(event)

    def _check_vertical_speed_events(
        self, icao: str, callsign: str, current_vs: int | None, alt: int | None, ac: dict, now: float
    ) -> list[dict]:
        """Check for VS-related safety events."""
        events = []

        if current_vs is None:
            return events

        abs_vs = abs(current_vs)
        display_name = callsign or icao

        # Extreme vertical speed (threshold is 6000 fpm)
        if abs_vs >= self.vs_extreme_threshold:
            direction = "climbing" if current_vs > 0 else "descending"

            if abs_vs >= 8000:
                severity = "critical"
            elif abs_vs >= 7000:
                severity = "warning"
            else:
                severity = "low"
        else:
            severity = None

        # Escalation bypasses the cooldown: a dive that worsens from 'low' to
        # 'critical' inside the 60s window must still re-alert
        if severity is not None and (
            self._can_trigger_event("extreme_vs", icao)
            or self._is_severity_escalation("extreme_vs", icao, None, severity)
        ):
            events.append(
                {
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
                        "squawk": ac.get("squawk"),
                    },
                    "aircraft_snapshot": self._build_aircraft_snapshot(ac),
                }
            )
            self._mark_event_triggered("extreme_vs", icao)

        # VS reversal detection (potential TCAS RA)
        state = self._aircraft_state.get(icao)
        if state and len(state.get("vs_history", [])) >= 2:
            vs_history = state["vs_history"]

            # Look for VS from ~4 seconds ago, bounded by the history retention
            # window: after a data gap (level flight without VS, coverage loss)
            # a minutes-old climb sample must not be compared against the
            # current VS as if it were 4 seconds ago.
            # NOTE: _update_state runs after this check, so vs_history holds
            # only past samples — the most recent entry is the previous frame.
            target_time = now - 4
            oldest_valid = now - self.HISTORY_RETENTION
            prev_vs = None
            for t, v in reversed(vs_history):
                if t <= target_time:
                    if t >= oldest_valid:
                        prev_vs = v
                    break

            if prev_vs is None:
                # Fallback for poll cadences under 4s: most recent sample that
                # is at least 2s old and still within retention
                for t, v in reversed(vs_history):
                    if now - 2 >= t >= oldest_valid:
                        prev_vs = v
                        break

            if prev_vs is not None:
                # Check for sign change (reversal)
                is_sign_change = prev_vs * current_vs < 0

                if is_sign_change:
                    abs_change = abs(current_vs - prev_vs)

                    # Skip VS reversals during takeoff/go-around. Use height above
                    # the field when near a listed airport (MSL would make this
                    # gate dead at high-elevation fields and over-broad at sea level).
                    alt_agl = alt
                    if alt is not None and is_valid_position(ac.get("lat"), ac.get("lon")):
                        apt = self._nearest_major_airport(ac.get("lat"), ac.get("lon"))
                        if apt is not None:
                            alt_agl = alt - apt[3]
                    is_takeoff = alt_agl is not None and alt_agl < 3000 and current_vs > 0

                    # TCAS RA: High magnitude reversal
                    is_tcas_ra = not is_takeoff and (
                        abs(prev_vs) >= self.tcas_vs_threshold and abs(current_vs) >= self.tcas_vs_threshold
                    )

                    if is_tcas_ra and self._can_trigger_event("tcas_ra", icao):
                        msg = f"TCAS RA suspected: {display_name} VS reversed from {prev_vs:+d} to {current_vs:+d} fpm"
                        events.append(
                            {
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
                                    "threshold": self.tcas_vs_threshold,
                                },
                                "aircraft_snapshot": self._build_aircraft_snapshot(ac),
                            }
                        )
                        self._mark_event_triggered("tcas_ra", icao)

                    elif not is_takeoff and abs_change >= self.vs_change_threshold:
                        # Regular VS reversal
                        severity = "warning" if abs_change >= 4000 else "low"

                        if self._can_trigger_event("vs_reversal", icao):
                            msg = f"VS reversal: {display_name} {prev_vs:+d} → {current_vs:+d} fpm"
                            events.append(
                                {
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
                                        "threshold": self.vs_change_threshold,
                                    },
                                    "aircraft_snapshot": self._build_aircraft_snapshot(ac),
                                }
                            )
                            self._mark_event_triggered("vs_reversal", icao)

        return events

    def _check_proximity_conflicts(self, positions: dict[str, dict]) -> list[dict]:
        """Check for proximity conflicts between aircraft pairs."""
        events = []
        icao_list = list(positions.keys())

        # Pre-calculate bounding box threshold in degrees
        deg_threshold = (self.proximity_nm / 60.0) * 2.0

        for i, icao1 in enumerate(icao_list):
            pos1 = positions[icao1]
            for icao2 in icao_list[i + 1 :]:
                pos2 = positions[icao2]

                # Fast bounding box check
                lat_diff = abs(pos1["lat"] - pos2["lat"])
                if lat_diff > deg_threshold:
                    continue
                lon_diff = abs(pos1["lon"] - pos2["lon"])
                if lon_diff > 180:
                    lon_diff = 360 - lon_diff  # Wrap across the antimeridian
                # One degree of longitude spans 60*cos(lat) nm — without the
                # cos scaling, genuinely close pairs above ~60° latitude would
                # be discarded before the haversine check
                lat_scale = max(0.05, math.cos(math.radians(pos1["lat"])))
                if lon_diff > deg_threshold / lat_scale:
                    continue

                dist_nm = calculate_distance_nm(pos1["lat"], pos1["lon"], pos2["lat"], pos2["lon"])

                if dist_nm > self.proximity_nm:
                    continue

                alt_diff = abs(pos1["alt"] - pos2["alt"])
                # Widen the skip gate when the pair mixes baro/geom altitude sources —
                # a reference mismatch shouldn't silence a genuine loss of separation.
                alt_gate = self.altitude_diff_ft
                if pos1.get("alt_source") != pos2.get("alt_source"):
                    alt_gate += self.MIXED_ALT_SOURCE_MARGIN_FT
                if alt_diff > alt_gate:
                    continue

                # Severity levels (computed early: critical geometry bypasses
                # both the takeoff/landing suppression and the cooldown)
                if dist_nm < 0.25 and alt_diff < 300:
                    severity = "critical"
                elif dist_nm < 0.35 or alt_diff < 400:
                    severity = "warning"
                else:
                    severity = "low"

                # Skip takeoff/landing pairs at major airports — but never
                # suppress critical geometry: a departure/arrival pair at
                # <0.25nm/<300ft is a genuine loss of separation, exactly the
                # scenario this filter must not silence
                if severity != "critical" and self._is_takeoff_landing_pair(pos1, pos2):
                    continue

                closure_rate = self._calculate_closure_rate(pos1, pos2)

                # Calculate CPA (Closest Point of Approach)
                cpa = self._calculate_cpa(pos1, pos2)

                # Skip if aircraft are diverging. When closure rate is known it
                # is the authoritative divergence test (a track filter here
                # would suppress converging reciprocal-track — i.e. head-on —
                # traffic, the worst-case geometry). When closure rate can't be
                # computed (missing gs) fall back to the track-difference
                # heuristic so already-passed opposite-direction pairs don't
                # raise false conflicts every cooldown window.
                #
                # The gate is an ABSOLUTE danger floor, intentionally decoupled
                # from the configurable proximity_nm: inside ALWAYS_ALERT_RADIUS_NM
                # the pair is too close to ever suppress on a divergence heuristic,
                # even for a tiny configured radius. Only beyond it do we filter
                # separating traffic.
                if dist_nm > self.ALWAYS_ALERT_RADIUS_NM:
                    if closure_rate is not None:
                        if closure_rate <= 0:
                            continue
                    elif pos1["track"] is not None and pos2["track"] is not None:
                        track_diff = abs(pos1["track"] - pos2["track"])
                        if track_diff > 180:
                            track_diff = 360 - track_diff
                        if track_diff > 150:
                            continue

                # Escalation bypasses the cooldown: a conflict that worsens
                # within the 60s window must still re-alert
                if self._can_trigger_event("proximity_conflict", icao1, icao2) or self._is_severity_escalation(
                    "proximity_conflict", icao1, icao2, severity
                ):
                    display1 = pos1["callsign"] or icao1
                    display2 = pos2["callsign"] or icao2
                    msg = (
                        f"Proximity conflict: {display1} and "
                        f"{display2} within {dist_nm:.2f}nm, "
                        f"{alt_diff}ft altitude separation"
                    )

                    if closure_rate is not None and closure_rate > 0:
                        msg += f", closure rate {closure_rate:.0f}kt"

                    events.append(
                        {
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
                                "cpa": cpa,  # May be None if CPA can't be calculated
                                "aircraft_1": {
                                    "icao": icao1,
                                    "callsign": display1,
                                    "lat": pos1["lat"],
                                    "lon": pos1["lon"],
                                    "alt": pos1["alt"],
                                    "gs": pos1["gs"],
                                    "track": pos1["track"],
                                    "vr": pos1["vr"],
                                },
                                "aircraft_2": {
                                    "icao": icao2,
                                    "callsign": display2,
                                    "lat": pos2["lat"],
                                    "lon": pos2["lon"],
                                    "alt": pos2["alt"],
                                    "gs": pos2["gs"],
                                    "track": pos2["track"],
                                    "vr": pos2["vr"],
                                },
                            },
                            "cpa_distance_nm": cpa["cpa_distance_nm"] if cpa else None,
                            "cpa_time_seconds": cpa["cpa_time_seconds"] if cpa else None,
                            "cpa_lat": cpa["cpa_lat"] if cpa else None,
                            "cpa_lon": cpa["cpa_lon"] if cpa else None,
                            "aircraft_snapshot": self._build_aircraft_snapshot(pos1["raw"]),
                            "aircraft_snapshot_2": self._build_aircraft_snapshot(pos2["raw"]),
                        }
                    )
                    self._mark_event_triggered("proximity_conflict", icao1, icao2)

        return events

    def _broadcast_event(self, event_type: str, event: dict):
        """Broadcast event to WebSocket clients."""
        from skyspy.socketio.utils import sync_emit

        # Map internal event types to Socket.IO event names expected by frontend
        event_name_map = {
            "safety_event": "safety:event",
            "safety_event_updated": "safety:event_updated",
            "safety_event_resolved": "safety:event_resolved",
        }
        socket_event = event_name_map.get(event_type, "safety:event")

        # Emit the DB id as the shared `id` so live pushes match snapshot-loaded
        # events (the snapshot uses str(SafetyEvent.id)). Preserve the internal
        # string id (the _active_events key) as `internal_id` for debugging.
        # Only new-event broadcasts stamp `timestamp` (the occurrence time):
        # clients merge update/resolve payloads over their stored event
        # ({...event, ...update}), so stamping those would overwrite the
        # original occurrence time with the ack/update time on every client.
        now_iso = timezone.now().isoformat().replace("+00:00", "Z")
        payload = {**event, "event_action": event_type, "updated_at": now_iso}
        if event_type == "safety_event":
            payload["timestamp"] = now_iso
        internal_id = payload.get("id")
        db_id = payload.get("db_id")
        if db_id is not None:
            payload["id"] = str(db_id)
            payload["internal_id"] = internal_id

        try:
            sync_emit(
                socket_event,
                payload,
                room="topic_safety",
            )
        except (ConnectionError, OSError, RuntimeError) as e:
            logger.warning(f"Failed to broadcast {event_type}: {type(e).__name__}: {e}")

    def _store_and_broadcast_event(self, event: dict):
        """Store event in database and broadcast to clients. Thread-safe."""
        # Store in database
        try:
            db_event = SafetyEvent.objects.create(
                event_type=event["event_type"],
                severity=event["severity"],
                icao_hex=event.get("icao") or event.get("icao_hex"),
                icao_hex_2=event.get("icao_2") or event.get("icao_hex_2"),
                callsign=event.get("callsign"),
                callsign_2=event.get("callsign_2"),
                message=event.get("message"),
                details=event.get("details"),
                aircraft_snapshot=event.get("aircraft_snapshot"),
                aircraft_snapshot_2=event.get("aircraft_snapshot_2"),
                cpa_distance_nm=event.get("cpa_distance_nm"),
                cpa_time_seconds=event.get("cpa_time_seconds"),
                cpa_lat=event.get("cpa_lat"),
                cpa_lon=event.get("cpa_lon"),
            )
            # Store DB ID back in active event (with lock) and on the local dict
            # so the broadcast below carries it as the shared `id`.
            event["db_id"] = db_event.id
            event_id = event.get("id")
            if event_id:
                with self._events_lock:
                    if event_id in self._active_events:
                        self._active_events[event_id]["db_id"] = db_event.id
        except (DatabaseError, InterfaceError) as e:
            # InterfaceError is a sibling of DatabaseError (not a subclass): a
            # stale/broken connection mid-emergency must not skip the broadcast
            logger.error(f"Failed to store safety event: {type(e).__name__}: {e}")

        # Broadcast new event to WebSocket clients
        self._broadcast_event("safety_event", event)

        # Route to the notification pipeline (Discord/Slack/ntfy/... via
        # Apprise) — this is the only path that produces push notifications
        # for emergency squawks, TCAS RAs, and proximity conflicts.
        try:
            from skyspy.services.notification_dispatcher import notification_dispatcher

            notification_dispatcher.dispatch_safety_event(event)
        except Exception:  # broad: notification fan-out must never break safety event storage/broadcast
            logger.exception("Failed to dispatch safety event notifications")

    def broadcast_event_updated(self, event: dict):
        """Broadcast an event update (e.g., acknowledgment change)."""
        self._broadcast_event("safety_event_updated", event)

    def broadcast_event_resolved(self, event: dict):
        """Broadcast an event resolution/clearing."""
        self._broadcast_event("safety_event_resolved", event)

    def get_stats(self) -> dict:
        """Get safety monitor statistics. Thread-safe."""
        with self._events_lock:
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
            "thresholds": self.get_thresholds(),
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
        """Get current monitor state. Thread-safe."""
        with self._events_lock:
            active_events_count = len(self._active_events)

        return {
            "tracked_aircraft": len(self._aircraft_state),
            "active_cooldowns": len(self._event_cooldown),
            "active_events": active_events_count,
        }

    def generate_test_events(self) -> list[dict]:
        """Generate test events for all safety event types."""
        now = time.time()
        test_events = []

        feeder_lat = getattr(settings, "FEEDER_LAT", 47.9377)
        feeder_lon = getattr(settings, "FEEDER_LON", -121.9687)

        # Test emergency squawk (7700)
        test_events.append(
            {
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
            }
        )

        # Test TCAS RA
        test_events.append(
            {
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
            }
        )

        # Test VS reversal (warning level)
        test_events.append(
            {
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
            }
        )

        # Test extreme VS
        test_events.append(
            {
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
            }
        )

        # Test proximity conflict
        test_events.append(
            {
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
            }
        )

        # Broadcast each test event so dashboards receive them live. Test
        # events are deliberately NOT persisted to the DB and NOT routed to the
        # notification pipeline: a fake "Squawk 7500 (Hijack)" must never page
        # real channels or pollute SafetyEvent history / worker rehydration.
        # Deliberately NOT added to _active_events either: this runs in the web
        # process, whose monitor never runs update_aircraft/_cleanup_old_state,
        # so entries there would be invisible to clients and leak forever.
        for event in test_events:
            event_id = f"test_{event['event_type']}:{event['icao']}:{uuid.uuid4().hex[:8]}"
            event["id"] = event_id
            event["created_at"] = now
            event["last_seen"] = now
            event["acknowledged"] = False
            event["is_test"] = True
            event.setdefault("details", {})["is_test"] = True
            self._broadcast_event("safety_event", event)

        logger.info(f"Generated {len(test_events)} test safety events")
        return test_events


# Global safety monitor instance
safety_monitor = SafetyMonitor()
