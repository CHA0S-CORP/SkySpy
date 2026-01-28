#!/usr/bin/env python3
"""
ADS-B Mock Service / ADSBexchange Live Proxy.

Works in two modes:
- SYNTHETIC: Generates realistic mock aircraft data (no API key needed)
- LIVE: Fetches real data from ADSBx API with synthetic fallback

Environment Variables:
    ADSBX_API_KEY: Your ADSBexchange API Key (optional - uses synthetic if not set)
    COVERAGE_LAT: Center latitude (default: 47.9377)
    COVERAGE_LON: Center longitude (default: -121.9687)
    COVERAGE_RADIUS_NM: Coverage radius in nautical miles (default: 250)
    CACHE_TTL: Seconds to cache response (default: 5)
    PORT: Server port (default: 80)
"""

import os
import json
import time
import math
import random
import string
import requests
from flask import Flask, jsonify
from threading import Lock
from typing import List, Dict

app = Flask(__name__)

# Configuration
ADSBX_API_KEY = os.getenv("ADSBX_API_KEY", "").strip() or None

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
last_api_error_time = 0  # Track API errors for backoff
api_backoff_until = 0    # Don't retry API until this time
message_count = 0
detected_conflicts: List[dict] = []
conflict_history: List[dict] = []
using_synthetic_data = False  # Track if we're using synthetic data

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
# Synthetic Data Generation (fallback when API unavailable)
# ============================================================================

# Sample airlines and aircraft types for realistic mock data
MOCK_AIRLINES = [
    ("AAL", "N", "A321"), ("UAL", "N", "B738"), ("DAL", "N", "A320"),
    ("SWA", "N", "B737"), ("ASA", "N", "B739"), ("JBU", "N", "A320"),
    ("SKW", "N", "E75L"), ("ENY", "N", "E145"), ("RPA", "N", "E170"),
    ("FFT", "N", "A320"), ("NKS", "N", "A320"), ("HAL", "N", "A330"),
]

def generate_synthetic_aircraft() -> List[dict]:
    """Generate realistic synthetic aircraft data for testing."""
    aircraft = []
    num_aircraft = random.randint(15, 40)

    for i in range(num_aircraft):
        # Random position within coverage area
        lat = COVERAGE_CENTER_LAT + random.uniform(-1.5, 1.5)
        lon = COVERAGE_CENTER_LON + random.uniform(-2.0, 2.0)

        # Pick airline or generate GA registration
        if random.random() < 0.8:  # 80% commercial
            airline, reg_prefix, ac_type = random.choice(MOCK_AIRLINES)
            flight = f"{airline}{random.randint(100, 9999)}"
            reg = f"{reg_prefix}{random.randint(100, 999)}{random.choice(string.ascii_uppercase)}{random.choice(string.ascii_uppercase)}"
            alt = random.randint(150, 420) * 100  # FL150-FL420
            gs = random.randint(380, 520)
            category = "A3"  # Large aircraft
        else:  # GA/small aircraft
            flight = ""
            reg = f"N{random.randint(1, 9999)}{random.choice(['', 'A', 'B', 'C'])}{random.choice(string.ascii_uppercase)}"
            ac_type = random.choice(["C172", "C182", "PA28", "BE36", "SR22"])
            alt = random.randint(20, 120) * 100  # 2000-12000ft
            gs = random.randint(90, 180)
            category = "A1"  # Light aircraft

        hex_code = ''.join(random.choices('0123456789abcdef', k=6))

        aircraft.append({
            "hex": hex_code,
            "flight": flight,
            "r": reg,
            "t": ac_type,
            "desc": f"{ac_type} aircraft",
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "alt_baro": alt,
            "gs": gs,
            "tas": gs + random.randint(-20, 40),
            "track": random.randint(0, 359),
            "track_rate": round(random.uniform(-1, 1), 2),
            "baro_rate": random.choice([0, 0, 0, random.randint(-2000, 2000)]),
            "geom_rate": 0,
            "squawk": f"{random.randint(0,7)}{random.randint(0,7)}{random.randint(0,7)}{random.randint(0,7)}",
            "category": category,
            "nav_qnh": 1013.25,
            "nav_altitude_mcp": alt,
            "nav_heading": random.randint(0, 359),
            "nic": 8,
            "rc": 186,
            "nac_p": 9,
            "nac_v": 2,
            "sil": 3,
            "sil_type": "perhour",
            "gva": 2,
            "sda": 2,
            "alert": 0,
            "spi": 0,
            "rssi": round(random.uniform(-25, -5), 1),
            "dbFlags": 0,
            "seen": round(random.uniform(0, 2), 1),
            "seen_pos": round(random.uniform(0, 2), 1),
            "messages": random.randint(100, 5000),
            "mlat": [],
            "tisb": [],
        })

    return aircraft


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
    Fetches data from ADSBexchange via RapidAPI, with fallback to synthetic data.
    """
    global cached_aircraft, last_fetch_time, message_count, api_backoff_until, using_synthetic_data

    now = time.time()

    # Return cache if within TTL
    if now - last_fetch_time < CACHE_TTL:
        return cached_aircraft

    # If no API key, use synthetic data
    if not ADSBX_API_KEY:
        return _use_synthetic_data(now)

    # If we're in backoff period, use synthetic data
    if now < api_backoff_until:
        return _use_synthetic_data(now)

    # CORRECTED URL for RapidAPI
    url = f"https://adsbexchange-com1.p.rapidapi.com/v2/lat/{COVERAGE_CENTER_LAT}/lon/{COVERAGE_CENTER_LON}/dist/{COVERAGE_RADIUS_NM}/"

    headers = {
        "X-RapidAPI-Key": ADSBX_API_KEY,
        "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com"
    }

    try:
        response = requests.get(url, headers=headers, timeout=5)

        # Handle rate limits and auth errors with backoff
        if response.status_code in (401, 403, 429):
            # Backoff: 60 seconds for rate limit, longer for auth errors
            backoff_seconds = 300 if response.status_code in (401, 403) else 60
            api_backoff_until = now + backoff_seconds
            if response.status_code == 429:
                print(f"Rate limited by ADSBx API, backing off for {backoff_seconds}s (using synthetic data)")
            else:
                print(f"API auth error ({response.status_code}), backing off for {backoff_seconds}s (using synthetic data)")
            return _use_synthetic_data(now)

        if response.status_code == 404:
            print(f"Error 404: The API path {url} is incorrect.")
            return _use_synthetic_data(now)

        response.raise_for_status()

        data = response.json()
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
            using_synthetic_data = False

        return cached_aircraft

    except requests.exceptions.RequestException as e:
        # Network errors - short backoff
        api_backoff_until = now + 30
        print(f"Network error fetching ADSBx data: {e} (using synthetic data)")
        return _use_synthetic_data(now)
    except Exception as e:
        print(f"Unexpected error fetching ADSBx data: {e}")
        return _use_synthetic_data(now)


def _use_synthetic_data(now: float) -> List[dict]:
    """Fall back to synthetic data generation."""
    global cached_aircraft, last_fetch_time, message_count, using_synthetic_data

    with data_lock:
        # Update synthetic aircraft positions slightly for realism
        if using_synthetic_data and cached_aircraft:
            # Nudge existing aircraft
            for ac in cached_aircraft:
                if ac.get("lat") and ac.get("lon"):
                    # Move based on track and speed
                    track_rad = math.radians(ac.get("track", 0))
                    speed_factor = (ac.get("gs", 300) / 3600) * CACHE_TTL / 60  # degrees per cache period
                    ac["lat"] = round(ac["lat"] + math.cos(track_rad) * speed_factor * 0.01, 6)
                    ac["lon"] = round(ac["lon"] + math.sin(track_rad) * speed_factor * 0.01, 6)
                    ac["seen"] = round(random.uniform(0, 2), 1)
                    ac["seen_pos"] = round(random.uniform(0, 2), 1)
        else:
            # Generate fresh synthetic data
            cached_aircraft = generate_synthetic_aircraft()
            using_synthetic_data = True

        last_fetch_time = now
        message_count += len(cached_aircraft) * 2

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
        "mode": "SYNTHETIC" if using_synthetic_data else "LIVE_PROXY",
        "data_source": "synthetic" if using_synthetic_data else "adsbexchange",
        "uptime": round(uptime, 0),
        "aircraft_tracked": count,
        "cached_seconds_ago": round(time.time() - last_fetch_time, 1),
        "api_backoff_remaining": max(0, round(api_backoff_until - time.time(), 0)) if api_backoff_until > time.time() else 0
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
    print(f"ADS-B Mock / Live Proxy")
    print(f"=" * 60)
    print(f"Center:       {COVERAGE_CENTER_LAT}, {COVERAGE_CENTER_LON}")
    print(f"Radius:       {COVERAGE_RADIUS_NM} NM")
    if ADSBX_API_KEY:
        print(f"API Key:      {'*' * 5}{ADSBX_API_KEY[-4:]}")
        print(f"Mode:         LIVE (with synthetic fallback)")
    else:
        print(f"API Key:      NOT SET")
        print(f"Mode:         SYNTHETIC ONLY")
    print(f"Conflict:     < {CONFLICT_HORIZONTAL_NM}nm / < {CONFLICT_VERTICAL_FT}ft")
    print(f"=" * 60)

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)