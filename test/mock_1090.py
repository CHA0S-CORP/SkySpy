#!/usr/bin/env python3
"""
ADSBexchange Live Proxy with Conflict Detection.
Fetches live data from ADSBx API, formats it for tar1090/readsb, 
and runs local conflict detection analysis.

Environment Variables:
    ADSBX_API_KEY: Your ADSBexchange API Key (REQUIRED)
    COVERAGE_LAT: Center latitude (default: 47.9377)
    COVERAGE_LON: Center longitude (default: -121.9687)
    COVERAGE_RADIUS_NM: Coverage radius in nautical miles (default: 25)
    CACHE_TTL: Seconds to cache API response to save credits (default: 5)
    PORT: Server port (default: 80)
"""

import os
import json
import time
import math
import traceback
import requests
from flask import Flask, jsonify
from threading import Lock
from typing import List, Dict

app = Flask(__name__)

# Configuration
ADSBX_API_KEY = os.getenv("ADSBX_API_KEY")
if not ADSBX_API_KEY:
    print("WARNING: ADSBX_API_KEY environment variable not set. API calls will fail.")

COVERAGE_CENTER_LAT = float(os.getenv("COVERAGE_LAT", "47.9377"))
COVERAGE_CENTER_LON = float(os.getenv("COVERAGE_LON", "-121.9687"))
COVERAGE_RADIUS_NM = float(os.getenv("COVERAGE_RADIUS_NM", "250"))
CACHE_TTL = int(os.getenv("CACHE_TTL", "5"))

# Conflict detection thresholds
CONFLICT_HORIZONTAL_NM = 3.0   
CONFLICT_VERTICAL_FT = 1000   

# Global State
data_lock = Lock()
cached_aircraft: List[dict] = []
last_fetch_time = 0
message_count = 0
detected_conflicts: List[dict] = []
conflict_history: List[dict] = []

# ============================================================================
# Math & Logic Helpers (Preserved from original)
# ============================================================================

def calculate_distance_nm(lat1, lon1, lat2, lon2):
    """Calculate distance in nautical miles between two points"""
    try:
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return 3440.065 * c
    except:
        return 0

def detect_conflicts(aircraft_list: List[dict]) -> List[dict]:
    """Detect proximity conflicts between live aircraft."""
    conflicts = []
    
    # Filter out ground traffic for conflict detection
    flying = [ac for ac in aircraft_list if ac.get("alt_baro") != "ground" and isinstance(ac.get("alt_baro"), (int, float))]
    
    for i, ac1 in enumerate(flying):
        for ac2 in flying[i+1:]:
            # Horizontal separation
            horiz_sep_nm = calculate_distance_nm(
                ac1["lat"], ac1["lon"],
                ac2["lat"], ac2["lon"]
            )
            
            # Vertical separation
            alt1 = ac1.get("alt_baro", 0)
            alt2 = ac2.get("alt_baro", 0)
            vert_sep_ft = abs(alt1 - alt2)
            
            if horiz_sep_nm < CONFLICT_HORIZONTAL_NM and vert_sep_ft < CONFLICT_VERTICAL_FT:
                # Basic closure rate calculation
                closure_rate = 0 # Difficult to calc accurately without history, defaulting 0
                
                # Determine severity
                if horiz_sep_nm < 1.0 and vert_sep_ft < 300:
                    severity = "CRITICAL"
                elif horiz_sep_nm < 2.0 and vert_sep_ft < 500:
                    severity = "WARNING"
                else:
                    severity = "ALERT"
                
                conflict = {
                    "id": f"{ac1['hex']}-{ac2['hex']}",
                    "time": time.time(),
                    "severity": severity,
                    "aircraft1": ac1,
                    "aircraft2": ac2,
                    "separation": {
                        "horizontal_nm": round(horiz_sep_nm, 2),
                        "vertical_ft": int(vert_sep_ft),
                    },
                    "dynamics": {
                        "closure_rate_kts": 0,
                        "converging": True, # Assumption for alerting
                    }
                }
                conflicts.append(conflict)
    
    return conflicts

# ============================================================================
# Live Data Fetching
# ============================================================================

def transform_adsbx_to_readsb(adsbx_ac):
    """
    Map ADSBx API fields to readsb/tar1090 format.
    """
    # ADSBx uses 'alt_baro' or 'alt_geom'. We prioritize baro.
    alt = adsbx_ac.get("alt_baro", adsbx_ac.get("alt_geom"))
    if alt == "ground":
        alt_val = 0
    elif alt is None:
        alt_val = 0
    else:
        try:
            alt_val = int(alt)
        except:
            alt_val = 0

    return {
        "hex": adsbx_ac.get("hex", "000000"),
        "flight": adsbx_ac.get("flight", "").strip(),
        "r": adsbx_ac.get("r", ""),
        "t": adsbx_ac.get("t", ""),
        "desc": adsbx_ac.get("desc", ""),
        "lat": adsbx_ac.get("lat"),
        "lon": adsbx_ac.get("lon"),
        "alt_baro": alt_val,
        "gs": adsbx_ac.get("gs", 0.0),
        "tas": round(adsbx_ac.get("tas", adsbx_ac.get("gs",0)), 1),
        "track": adsbx_ac.get("track", 0.0),
        "track_rate": adsbx_ac.get("track_rate", 0.0),
        "baro_rate": int(adsbx_ac.get("baro_rate",0)),
        "geom_rate": int(adsbx_ac.get("geom_rate", adsbx_ac.get("baro_rate",0))),
        "squawk":adsbx_ac.get("squawk",""),
        "category": adsbx_ac.get("category",""),
        "nav_qnh": adsbx_ac.get("nav_qnh", 1013.25),
        "nav_altitude_mcp": adsbx_ac.get("nav_altitude_mcp"),
        "nav_heading": round(adsbx_ac.get("nav_heading", adsbx_ac.get("track",0)), 1),
        "nic": adsbx_ac.get("nic", 8),
        "rc": adsbx_ac.get("rc", 186),
        "nac_p": adsbx_ac.get("nac_p", 9),
        "nac_v": adsbx_ac.get("nac_v", 2),
        "sil": adsbx_ac.get("sil", 3),
        "sil_type": adsbx_ac.get("sil_type", "perhour"),
        "gva": adsbx_ac.get("gva", 2),
        "sda": adsbx_ac.get("sda", 2),
        "alert": adsbx_ac.get("alert", 0),
        "spi": adsbx_ac.get("spi", 0),
        "rssi": round(adsbx_ac.get("rssi",-15), 1),
        "dbFlags": adsbx_ac.get("dbFlags",0),
        "seen": round(adsbx_ac.get("seen",0), 1),
        "seen_pos": round(adsbx_ac.get("seen_pos",0), 1),
        "messages": adsbx_ac.get("messages", 0),
        "mlat": adsbx_ac.get("mlat", []),
        "tisb": adsbx_ac.get("tisb", []),
        }


def fetch_live_data():
    """
    Fetches data from ADSBexchange via RapidAPI.
    """
    global cached_aircraft, last_fetch_time, message_count

    now = time.time()
    
    # Return cache if within TTL
    if now - last_fetch_time < CACHE_TTL:
        return cached_aircraft

    # CORRECTED URL for RapidAPI
    # Note: The trailing slash is often required by ADSBx API
    url = f"https://adsbexchange-com1.p.rapidapi.com/v2/lat/{COVERAGE_CENTER_LAT}/lon/{COVERAGE_CENTER_LON}/dist/{COVERAGE_RADIUS_NM}/"
    
    # CORRECTED HEADERS for RapidAPI
    headers = {
        "X-RapidAPI-Key": ADSBX_API_KEY,
        "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com"
    }

    try:
        response = requests.get(url, headers=headers, timeout=5)
        
        # specific error handling to help debug
        if response.status_code == 403:
            print(f"Error 403: Check your ADSBX_API_KEY. It might be invalid or you are not subscribed on RapidAPI.")
            return cached_aircraft
        if response.status_code == 404:
            print(f"Error 404: The API path {url} is incorrect.")
            return cached_aircraft
            
        response.raise_for_status()
        
        data = response.json()
        
        # ADSBx RapidAPI response structure is usually {"ac": [...], "msg": "..."}
        raw_list = data.get("ac", [])
        
        # Transform data to standard readsb format
        processed_list = []
        for ac in raw_list:
            if ac.get("lat") is None or ac.get("lon") is None:
                continue
            processed_list.append(transform_adsbx_to_readsb(ac))
            
        with data_lock:
            cached_aircraft = processed_list
            last_fetch_time = now
            message_count += len(processed_list) * 2
            
        return cached_aircraft

    except Exception as e:
        traceback.print_exc()
        print(f"Error fetching ADSBx data: {e}")
        return cached_aircraft

# ============================================================================
# Endpoints
# ============================================================================

@app.route("/tar1090/data/aircraft.json")
@app.route("/data/aircraft.json")
def aircraft_json():
    """Main aircraft data endpoint compatible with tar1090"""
    aircraft = fetch_live_data()
    
    return jsonify({
        "now": time.time(),
        "messages": message_count,
        "aircraft": aircraft
    })

@app.route("/tar1090/data/receiver.json")
def receiver_json():
    return jsonify({
        "version": "adsbx-proxy-live",
        "refresh": 1000,
        "history": 120,
        "lat": COVERAGE_CENTER_LAT,
        "lon": COVERAGE_CENTER_LON
    })

@app.route("/tar1090/data/stats.json")
def stats_json():
    """Mock stats endpoint to satisfy UI clients"""
    with data_lock:
        ac_count = len(cached_aircraft)
        
    return jsonify({
        "latest": {
            "start": time.time() - 60,
            "end": time.time(),
            "tracks": {"all": ac_count},
            "messages": message_count
        }
    })

# ============================================================================
# Utility & Analysis Endpoints
# ============================================================================

@app.route("/health")
def health():
    uptime = time.time() - server_start_time
    with data_lock:
        count = len(cached_aircraft)
    return jsonify({
        "status": "healthy",
        "mode": "LIVE_PROXY",
        "uptime": round(uptime, 0),
        "aircraft_tracked": count,
        "cached_seconds_ago": round(time.time() - last_fetch_time, 1)
    })

@app.route("/config")
def config():
    return jsonify({
        "center_lat": COVERAGE_CENTER_LAT,
        "center_lon": COVERAGE_CENTER_LON,
        "radius_nm": COVERAGE_RADIUS_NM,
        "cache_ttl": CACHE_TTL
    })

@app.route("/emergencies")
def emergencies():
    """Return live aircraft with emergency squawks"""
    aircraft = fetch_live_data()
    EMERGENCY_CODES = ["7500", "7600", "7700"]
    
    found = [ac for ac in aircraft if ac.get("squawk") in EMERGENCY_CODES]
    return jsonify({"count": len(found), "aircraft": found})

@app.route("/military")
def military():
    """Return live military aircraft (based on dbFlags)"""
    aircraft = fetch_live_data()
    # dbFlags bit 0 is usually military/interesting
    found = [ac for ac in aircraft if str(ac.get("dbFlags", "0")) == "1" or ac.get("dbFlags", 0) == 1]
    return jsonify({"count": len(found), "aircraft": found})

@app.route("/conflicts")
def conflicts():
    """Run conflict detection on LIVE data"""
    global conflict_history
    
    aircraft = fetch_live_data()
    current_conflicts = detect_conflicts(aircraft)
    
    # Update history logic
    cutoff = time.time() - 300
    conflict_history = [c for c in conflict_history if c["time"] > cutoff]
    
    # Add new unique conflicts to history
    current_ids = [c["id"] for c in current_conflicts]
    for c in current_conflicts:
        # Simple history check - if ID exists recently, update time
        existing = next((h for h in conflict_history if h["id"] == c["id"]), None)
        if existing:
            existing["time"] = time.time()
            existing["separation"] = c["separation"]
        else:
            conflict_history.append(c)

    return jsonify({
        "active_conflicts": len(current_conflicts),
        "conflicts": current_conflicts,
        "thresholds": {
            "horizontal_nm": CONFLICT_HORIZONTAL_NM,
            "vertical_ft": CONFLICT_VERTICAL_FT
        }
    })

@app.route("/")
def index():
    return jsonify({
        "service": "ADSBx Live Proxy",
        "description": "Proxy converting ADSBexchange API data to tar1090 format with local analysis",
        "endpoints": [
            "/tar1090/data/aircraft.json",
            "/conflicts",
            "/emergencies",
            "/military",
            "/health"
        ]
    })

if __name__ == "__main__":
    server_start_time = time.time()
    port = int(os.getenv("PORT", "80"))
    
    print(f"=" * 60)
    print(f"ADSBx Live Data Proxy")
    print(f"=" * 60)
    print(f"Center:       {COVERAGE_CENTER_LAT}, {COVERAGE_CENTER_LON}")
    print(f"Radius:       {COVERAGE_RADIUS_NM} NM")
    print(f"API Key:      {'*' * 5}{ADSBX_API_KEY[-4:] if ADSBX_API_KEY else 'MISSING'}")
    print(f"Conflict:     < {CONFLICT_HORIZONTAL_NM}nm / < {CONFLICT_VERTICAL_FT}ft")
    print(f"=" * 60)
    
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)