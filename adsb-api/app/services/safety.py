"""
Safety monitoring service for TCAS conflicts and dangerous flight parameters.
"""
import logging
import math
import threading
import time
from typing import Optional

from app.core.config import get_settings
from app.core.utils import calculate_distance_nm, is_valid_position, safe_int_altitude

logger = logging.getLogger(__name__)
settings = get_settings()


class SafetyMonitor:
    """
    Monitors for TCAS-like conflicts and dangerous flight parameters.
    
    Detection capabilities:
    - TCAS Resolution Advisory detection (rapid climb/descent maneuvers)
    - Extreme vertical speed monitoring
    - Vertical speed reversals (potential TCAS RA response)
    - Proximity conflicts between aircraft pairs
    """
    
    EVENT_COOLDOWN = 60  # seconds
    HISTORY_RETENTION = 30  # seconds
    
    def __init__(self):
        self._aircraft_state: dict[str, dict] = {}
        self._event_cooldown: dict[str, float] = {}
        self._lock = threading.Lock()
        self._enabled = settings.safety_monitoring_enabled  # Runtime enable/disable
    
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
        """Remove state older than retention period."""
        now = time.time()
        cutoff = now - self.HISTORY_RETENTION
        
        with self._lock:
            to_remove = [
                icao for icao, state in self._aircraft_state.items()
                if state.get("last_update", 0) < cutoff
            ]
            for icao in to_remove:
                del self._aircraft_state[icao]
            
            old_cooldowns = [k for k, v in self._event_cooldown.items() if v < cutoff]
            for k in old_cooldowns:
                del self._event_cooldown[k]
    
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
            
            if is_valid_position(lat, lon) and alt is not None:
                current_positions[icao] = {
                    "lat": lat, "lon": lon, "alt": alt,
                    "vr": vr, "gs": gs, "track": track,
                    "callsign": callsign, "raw": ac
                }
            
            vs_events = self._check_vertical_speed_events(icao, callsign, vr, alt, ac, now)
            events.extend(vs_events)
            
            self._update_state(icao, vr, alt, lat, lon, gs, track, now)
        
        proximity_events = self._check_proximity_conflicts(current_positions)
        events.extend(proximity_events)
        
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
        
        # Extreme vertical speed
        if abs_vs >= settings.safety_vs_extreme_threshold:
            if self._can_trigger_event("extreme_vs", icao):
                direction = "climbing" if current_vs > 0 else "descending"
                severity = "critical" if abs_vs >= 6000 else "warning"
                
                events.append({
                    "event_type": "extreme_vs",
                    "severity": severity,
                    "icao": icao,
                    "callsign": callsign,
                    "message": f"Extreme vertical speed: {direction} at {abs_vs} fpm",
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
        
        # VS change/reversal (potential TCAS RA)
        with self._lock:
            state = self._aircraft_state.get(icao)
            if state and len(state.get("vs_history", [])) >= 2:
                vs_history = state["vs_history"]
                
                target_time = now - 4
                prev_vs = None
                for t, v in reversed(vs_history[:-1]):
                    if t <= target_time:
                        prev_vs = v
                        break
                
                if prev_vs is None and len(vs_history) >= 2:
                    prev_vs = vs_history[-2][1]
                
                if prev_vs is not None:
                    vs_change = current_vs - prev_vs
                    abs_change = abs(vs_change)
                    
                    if abs_change >= settings.safety_vs_change_threshold:
                        is_reversal = (
                            prev_vs * current_vs < 0 and
                            abs(prev_vs) >= settings.safety_tcas_vs_threshold and
                            abs(current_vs) >= settings.safety_tcas_vs_threshold
                        )
                        
                        if is_reversal:
                            event_type = "tcas_ra"
                            severity = "critical"
                            msg = f"TCAS RA suspected: VS reversed from {prev_vs:+d} to {current_vs:+d} fpm"
                        else:
                            if vs_change * prev_vs < 0:
                                event_type = "vs_reversal"
                            elif current_vs < 0:
                                event_type = "rapid_descent"
                            else:
                                event_type = "rapid_climb"
                            severity = "warning"
                            msg = f"Rapid VS change: {prev_vs:+d} → {current_vs:+d} fpm (Δ{abs_change})"
                        
                        if self._can_trigger_event(event_type, icao):
                            events.append({
                                "event_type": event_type,
                                "severity": severity,
                                "icao": icao,
                                "callsign": callsign,
                                "message": msg,
                                "details": {
                                    "previous_vs": prev_vs,
                                    "current_vs": current_vs,
                                    "vs_change": vs_change,
                                    "altitude": alt,
                                    "lat": ac.get("lat"),
                                    "lon": ac.get("lon"),
                                    "gs": ac.get("gs"),
                                    "squawk": ac.get("squawk"),
                                    "threshold": settings.safety_vs_change_threshold
                                }
                            })
                            self._mark_event_triggered(event_type, icao)
        
        return events
    
    def _check_proximity_conflicts(self, positions: dict[str, dict]) -> list[dict]:
        """Check for proximity conflicts between aircraft pairs."""
        events = []
        icao_list = list(positions.keys())
        
        for i, icao1 in enumerate(icao_list):
            for icao2 in icao_list[i + 1:]:
                pos1 = positions[icao1]
                pos2 = positions[icao2]
                
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
                    severity = "critical" if (dist_nm < 0.5 and alt_diff < 500) else "warning"
                    
                    msg = (
                        f"Proximity conflict: {pos1['callsign'] or icao1} and "
                        f"{pos2['callsign'] or icao2} within {dist_nm:.2f}nm, "
                        f"{alt_diff}ft altitude separation"
                    )
                    
                    if closure_rate is not None and closure_rate > 0:
                        msg += f", closure rate {closure_rate:.0f}kt"
                    
                    events.append({
                        "event_type": "proximity_conflict",
                        "severity": severity,
                        "icao": icao1,
                        "icao_2": icao2,
                        "callsign": pos1["callsign"],
                        "callsign_2": pos2["callsign"],
                        "message": msg,
                        "details": {
                            "distance_nm": round(dist_nm, 3),
                            "altitude_diff_ft": alt_diff,
                            "closure_rate_kt": closure_rate,
                            "aircraft_1": {
                                "icao": icao1,
                                "callsign": pos1["callsign"],
                                "lat": pos1["lat"],
                                "lon": pos1["lon"],
                                "alt": pos1["alt"],
                                "gs": pos1["gs"],
                                "track": pos1["track"],
                                "vr": pos1["vr"]
                            },
                            "aircraft_2": {
                                "icao": icao2,
                                "callsign": pos2["callsign"],
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
            return {
                "tracked_aircraft": len(self._aircraft_state),
                "active_cooldowns": len(self._event_cooldown),
                "monitoring_enabled": self.enabled,
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
