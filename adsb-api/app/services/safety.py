"""
Safety monitoring service for TCAS conflicts and dangerous flight parameters.
"""
import logging
import math
import threading
import time
import uuid
from typing import Optional

from app.core.config import get_settings
from app.core.utils import calculate_distance_nm, is_valid_position, safe_int_altitude

logger = logging.getLogger(__name__)
settings = get_settings()

# Emergency squawk codes and their meanings
EMERGENCY_SQUAWKS = {
    "7500": {"type": "hijack", "label": "HIJACK", "severity": "critical"},
    "7600": {"type": "radio_failure", "label": "RADIO FAILURE", "severity": "warning"},
    "7700": {"type": "emergency", "label": "EMERGENCY", "severity": "critical"},
}


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
        self._aircraft_state: dict[str, dict] = {}
        self._event_cooldown: dict[str, float] = {}
        self._active_events: dict[str, dict] = {}  # event_id -> event data
        self._acknowledged_events: set[str] = set()  # Set of acknowledged event IDs
        self._lock = threading.Lock()
        self._enabled = settings.safety_monitoring_enabled
    
    @property
    def enabled(self) -> bool:
        """Check if safety monitoring is enabled."""
        return self._enabled
    
    @enabled.setter
    def enabled(self, value: bool):
        """Enable or disable safety monitoring."""
        self._enabled = value
    
    def _get_cooldown_key(self, event_type: str, icao: str, icao_2: Optional[str] = None) -> str:
        """Generate a cooldown key for an event."""
        if icao_2:
            pair = tuple(sorted([icao, icao_2]))
            return f"{event_type}:{pair[0]}:{pair[1]}"
        return f"{event_type}:{icao}"
    
    def _can_trigger_event(self, event_type: str, icao: str, icao_2: Optional[str] = None) -> bool:
        """Check if we can trigger an event (respects cooldown)."""
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
        cutoff = now - self.HISTORY_RETENTION
        event_cutoff = now - self.EVENT_EXPIRY

        with self._lock:
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
                eid for eid, event in self._active_events.items()
                if event.get("last_seen", 0) < event_cutoff
            ]
            for eid in expired_events:
                del self._active_events[eid]
                self._acknowledged_events.discard(eid)

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
            event["icao"],
            event.get("icao_2")
        )
        now = time.time()

        with self._lock:
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

    def acknowledge_event(self, event_id: str) -> bool:
        """Acknowledge an event by ID. Returns True if successful."""
        with self._lock:
            if event_id in self._active_events:
                self._acknowledged_events.add(event_id)
                self._active_events[event_id]["acknowledged"] = True
                return True
            return False

    def unacknowledge_event(self, event_id: str) -> bool:
        """Remove acknowledgment from an event. Returns True if successful."""
        with self._lock:
            if event_id in self._active_events:
                self._acknowledged_events.discard(event_id)
                self._active_events[event_id]["acknowledged"] = False
                return True
            return False

    def get_active_events(self, include_acknowledged: bool = True) -> list[dict]:
        """Get all active safety events."""
        with self._lock:
            events = list(self._active_events.values())
            if not include_acknowledged:
                events = [e for e in events if not e.get("acknowledged", False)]
            return events

    def clear_event(self, event_id: str) -> bool:
        """Remove an event entirely. Returns True if successful."""
        with self._lock:
            if event_id in self._active_events:
                del self._active_events[event_id]
                self._acknowledged_events.discard(event_id)
                return True
            return False

    def clear_all_events(self):
        """Clear all active events and acknowledgments."""
        with self._lock:
            self._active_events.clear()
            self._acknowledged_events.clear()
    
    def update_aircraft(self, aircraft_list: list[dict]) -> list[dict]:
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
            alt = safe_int_altitude(ac.get("alt_baro")) or safe_int_altitude(ac.get("alt_geom"))
            vr = ac.get("baro_rate") or ac.get("geom_rate")
            gs = ac.get("gs")
            track = ac.get("track")
            callsign = (ac.get("flight") or "").strip()
            squawk = ac.get("squawk", "")

            if is_valid_position(lat, lon) and alt is not None:
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
        stored_events = [self._store_event(e) for e in events]
        return stored_events

    def _check_emergency_squawk(
        self, icao: str, callsign: str, squawk: str, ac: dict
    ) -> list[dict]:
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
            "callsign": display_name,
            "flight": display_name,
            "squawk": squawk,
            "message": f"{squawk_info['label']}: {display_name} squawking {squawk}",
            "details": {
                "squawk": squawk,
                "squawk_type": squawk_info["type"],
                "squawk_label": squawk_info["label"],
                "altitude": ac.get("alt_baro") or ac.get("alt_geom"),
                "lat": ac.get("lat"),
                "lon": ac.get("lon"),
                "gs": ac.get("gs"),
                "track": ac.get("track"),
                "vr": ac.get("baro_rate") or ac.get("geom_rate")
            }
        })

        return events
    
    def _update_state(
        self, icao: str, vr: Optional[int], alt: Optional[int],
        lat: Optional[float], lon: Optional[float],
        gs: Optional[float], track: Optional[float], now: float
    ):
        """Update aircraft state history."""
        with self._lock:
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
                state["vs_history"] = [
                    (t, v) for t, v in state["vs_history"]
                    if t > now - self.HISTORY_RETENTION
                ]
            
            if alt is not None:
                state["alt_history"].append((now, alt))
                state["alt_history"] = [
                    (t, a) for t, a in state["alt_history"]
                    if t > now - self.HISTORY_RETENTION
                ]
            
            state["lat"] = lat
            state["lon"] = lon
            state["gs"] = gs
            state["track"] = track
    
    def _check_vertical_speed_events(
        self, icao: str, callsign: str,
        current_vs: Optional[int], alt: Optional[int],
        ac: dict, now: float
    ) -> list[dict]:
        """Check for VS-related safety events."""
        events = []
        
        if current_vs is None:
            return events
        
        abs_vs = abs(current_vs)
        
        # Extreme vertical speed (threshold is 6000 fpm - very unusual)
        if abs_vs >= settings.safety_vs_extreme_threshold:
            if self._can_trigger_event("extreme_vs", icao):
                direction = "climbing" if current_vs > 0 else "descending"
                # Severity based on VS magnitude (threshold is already high at 6000)
                if abs_vs >= 8000:
                    severity = "critical"
                elif abs_vs >= 7000:
                    severity = "warning"
                else:
                    severity = "low"

                display_name = callsign or icao
                events.append({
                    "event_type": "extreme_vs",
                    "severity": severity,
                    "icao": icao,
                    "callsign": display_name,
                    "flight": display_name,
                    "message": f"Extreme vertical speed: {display_name} {direction} at {abs_vs} fpm",
                    "details": {
                        "vertical_rate": current_vs,
                        "altitude": alt,
                        "threshold": settings.safety_vs_extreme_threshold,
                        "lat": ac.get("lat"),
                        "lon": ac.get("lon"),
                        "gs": ac.get("gs"),
                        "squawk": ac.get("squawk")
                    }
                })
                self._mark_event_triggered("extreme_vs", icao)
        
        # VS reversal detection (potential TCAS RA)
        # Only triggers when aircraft changes vertical direction (climb to descent or vice versa)
        with self._lock:
            state = self._aircraft_state.get(icao)
            if state and len(state.get("vs_history", [])) >= 2:
                vs_history = state["vs_history"]

                # Look for VS from ~4 seconds ago to detect reversals
                target_time = now - 4
                prev_vs = None
                for t, v in reversed(vs_history[:-1]):
                    if t <= target_time:
                        prev_vs = v
                        break

                if prev_vs is None and len(vs_history) >= 2:
                    prev_vs = vs_history[-2][1]

                if prev_vs is not None:
                    # Only trigger if there's an actual sign change (reversal)
                    # prev_vs * current_vs < 0 means one is positive and one is negative
                    is_sign_change = prev_vs * current_vs < 0

                    if is_sign_change:
                        abs_change = abs(current_vs - prev_vs)

                        # TCAS RA: High magnitude reversal (both sides have significant VS)
                        is_tcas_ra = (
                            abs(prev_vs) >= settings.safety_tcas_vs_threshold and
                            abs(current_vs) >= settings.safety_tcas_vs_threshold
                        )

                        if is_tcas_ra:
                            event_type = "tcas_ra"
                            severity = "critical"
                            tcas_display_name = callsign or icao
                            msg = f"TCAS RA suspected: {tcas_display_name} VS reversed from {prev_vs:+d} to {current_vs:+d} fpm"
                        else:
                            # Regular VS reversal - only if change magnitude is significant
                            if abs_change < settings.safety_vs_change_threshold:
                                # Not significant enough, skip
                                pass
                            else:
                                event_type = "vs_reversal"
                                # Severity based on magnitude
                                if abs_change >= 4000:
                                    severity = "warning"
                                else:
                                    severity = "low"
                                display_name = callsign or icao
                                msg = f"VS reversal: {display_name} {prev_vs:+d} → {current_vs:+d} fpm"

                                if self._can_trigger_event(event_type, icao):
                                    events.append({
                                        "event_type": event_type,
                                        "severity": severity,
                                        "icao": icao,
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
                                            "threshold": settings.safety_vs_change_threshold
                                        }
                                    })
                                    self._mark_event_triggered(event_type, icao)

                        # Handle TCAS RA event separately (already checked is_tcas_ra above)
                        if is_tcas_ra and self._can_trigger_event("tcas_ra", icao):
                            events.append({
                                "event_type": "tcas_ra",
                                "severity": "critical",
                                "icao": icao,
                                "callsign": tcas_display_name,
                                "flight": tcas_display_name,
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
                                    "threshold": settings.safety_tcas_vs_threshold
                                }
                            })
                            self._mark_event_triggered("tcas_ra", icao)
        
        return events
    
    def _check_proximity_conflicts(self, positions: dict[str, dict]) -> list[dict]:
        """Check for proximity conflicts between aircraft pairs."""
        events = []
        icao_list = list(positions.keys())
        
        for i, icao1 in enumerate(icao_list):
            for icao2 in icao_list[i + 1:]:
                pos1 = positions[icao1]
                pos2 = positions[icao2]

                # Skip if either aircraft is likely on the ground (<500ft)
                if pos1["alt"] < 500 or pos2["alt"] < 500:
                    continue

                dist_nm = calculate_distance_nm(
                    pos1["lat"], pos1["lon"],
                    pos2["lat"], pos2["lon"]
                )

                if dist_nm > settings.safety_proximity_nm:
                    continue

                alt_diff = abs(pos1["alt"] - pos2["alt"])
                if alt_diff > settings.safety_altitude_diff_ft:
                    continue
                
                closure_rate = self._calculate_closure_rate(pos1, pos2)
                
                if self._can_trigger_event("proximity_conflict", icao1, icao2):
                    # Severity levels based on separation (thresholds: 0.5nm, 500ft)
                    # Critical: Very close (<0.25nm AND <300ft)
                    # Warning: Close (<0.35nm or <400ft)
                    # Low: Within threshold but more separation
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
                        "icao_2": icao2,
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
                                "flight": display1,
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
                                "flight": display2,
                                "lat": pos2["lat"],
                                "lon": pos2["lon"],
                                "alt": pos2["alt"],
                                "gs": pos2["gs"],
                                "track": pos2["track"],
                                "vr": pos2["vr"]
                            }
                        }
                    })
                    self._mark_event_triggered("proximity_conflict", icao1, icao2)
        
        return events
    
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
    
    def get_stats(self) -> dict:
        """Get safety monitor statistics."""
        with self._lock:
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
            "vs_change": settings.safety_vs_change_threshold,
            "vs_extreme": settings.safety_vs_extreme_threshold,
            "proximity_nm": settings.safety_proximity_nm,
            "altitude_diff_ft": settings.safety_altitude_diff_ft,
        }
    
    def get_state(self) -> dict:
        """Get current monitor state."""
        with self._lock:
            return {
                "tracked_aircraft": len(self._aircraft_state),
                "active_cooldowns": len(self._event_cooldown),
            }


# Global safety monitor instance
safety_monitor = SafetyMonitor()
