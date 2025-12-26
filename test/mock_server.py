#!/usr/bin/env python3
"""
Mock server for ultrafeeder and dump978 endpoints.
Returns realistic sample data with moving aircraft tracks.

Environment Variables:
    MOCK_TYPE: "ultrafeeder" or "dump978" (default: ultrafeeder)
    COVERAGE_LAT: Center latitude (default: 47.9377)
    COVERAGE_LON: Center longitude (default: -121.9687)
    COVERAGE_RADIUS_NM: Coverage radius in nautical miles (default: 150)
    TRAFFIC_DENSITY: "low", "medium", "high" (default: medium)
    EMERGENCY_RATE: Probability of emergency squawk 0.0-1.0 (default: 0.05)
    ENABLE_WEATHER: Enable wind effects "true"/"false" (default: true)
    PORT: Server port (default: 80)
"""

import os
import json
import random
import time
import math
from flask import Flask, jsonify, request
from threading import Lock
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from enum import Enum

app = Flask(__name__)

# Configuration from environment
MOCK_TYPE = os.getenv("MOCK_TYPE", "ultrafeeder")
ENABLE_WEATHER = os.getenv("ENABLE_WEATHER", "true").lower() == "true"
EMERGENCY_RATE = float(os.getenv("EMERGENCY_RATE", "0.05"))
TRAFFIC_DENSITY = os.getenv("TRAFFIC_DENSITY", "medium")

# Coverage area configuration
COVERAGE_CENTER_LAT = float(os.getenv("COVERAGE_LAT", "47.9377"))
COVERAGE_CENTER_LON = float(os.getenv("COVERAGE_LON", "-121.9687"))
COVERAGE_RADIUS_NM = float(os.getenv("COVERAGE_RADIUS_NM", "150"))

# Wind configuration (simulated)
WIND_DIRECTION = random.randint(0, 359)  # Degrees from
WIND_SPEED_KTS = random.randint(5, 35)   # Knots

# Traffic density multipliers
DENSITY_MULTIPLIERS = {
    "low": 0.5,
    "medium": 1.0,
    "high": 2.0,
}

# Aircraft state management
aircraft_state: Dict[str, dict] = {}
uat_aircraft_state: Dict[str, dict] = {}
state_lock = Lock()
last_update_time = time.time()
server_start_time = time.time()
message_count = 0


class FlightProfile(Enum):
    CRUISE = "cruise"
    CLIMB = "climb"
    DESCEND = "descend"
    PATTERN = "pattern"
    HOLDING = "holding"
    APPROACH = "approach"
    DEPARTURE = "departure"
    HELICOPTER = "helicopter"
    GROUND = "ground"


# Conflict detection thresholds
CONFLICT_HORIZONTAL_NM = 3.0   # Nautical miles
CONFLICT_VERTICAL_FT = 1000   # Feet

# Track detected conflicts
detected_conflicts: List[dict] = []
conflict_history: List[dict] = []

# Aircraft templates with realistic flight profiles
AIRCRAFT_TEMPLATES = [
    # Commercial airliners
    {
        "hex": "A12345", "flight": "UAL123  ", "category": "A3", "t": "B738",
        "dbFlags": 0, "profile": "cruise", "target_alt": 35000, "r": "N12345",
        "desc": "Boeing 737-800",
    },
    {
        "hex": "A98765", "flight": "DAL456  ", "category": "A3", "t": "B739",
        "dbFlags": 0, "profile": "cruise", "target_alt": 38000, "r": "N98765",
        "desc": "Boeing 737-900",
    },
    {
        "hex": "A55555", "flight": "SWA789  ", "category": "A3", "t": "B737",
        "dbFlags": 0, "profile": "descend", "target_alt": 3000, "r": "N555WN",
        "desc": "Boeing 737-700",
    },
    {
        "hex": "A66666", "flight": "ASA234  ", "category": "A3", "t": "B739",
        "dbFlags": 0, "profile": "climb", "target_alt": 36000, "r": "N623AS",
        "desc": "Boeing 737-900ER",
    },
    {
        "hex": "A77777", "flight": "AAL567  ", "category": "A3", "t": "A321",
        "dbFlags": 0, "profile": "cruise", "target_alt": 34000, "r": "N567AA",
        "desc": "Airbus A321",
    },
    {
        "hex": "AB1234", "flight": "UAL456  ", "category": "A5", "t": "B77W",
        "dbFlags": 0, "profile": "cruise", "target_alt": 40000, "r": "N2645U",
        "desc": "Boeing 777-300ER",
    },
    {
        "hex": "AC5678", "flight": "DAL789  ", "category": "A5", "t": "A359",
        "dbFlags": 0, "profile": "cruise", "target_alt": 41000, "r": "N517DZ",
        "desc": "Airbus A350-900",
    },
    # Cargo
    {
        "hex": "A44444", "flight": "FDX123  ", "category": "A5", "t": "B763",
        "dbFlags": 0, "profile": "cruise", "target_alt": 32000, "r": "N123FE",
        "desc": "Boeing 767-300F",
    },
    {
        "hex": "A43210", "flight": "UPS456  ", "category": "A5", "t": "B748",
        "dbFlags": 0, "profile": "descend", "target_alt": 10000, "r": "N456UP",
        "desc": "Boeing 747-8F",
    },
    # Military
    {
        "hex": "AE1234", "flight": "RCH001  ", "category": "A5", "t": "C17",
        "dbFlags": 1, "profile": "cruise", "target_alt": 28000, "r": "05-5140",
        "desc": "Boeing C-17 Globemaster III",
    },
    {
        "hex": "AE5678", "flight": "EVAC01  ", "category": "A5", "t": "C130",
        "dbFlags": 1, "profile": "cruise", "target_alt": 22000, "r": "08-8601",
        "desc": "Lockheed C-130J Super Hercules",
    },
    {
        "hex": "AE9999", "flight": "DUKE01  ", "category": "A2", "t": "C12",
        "dbFlags": 1, "profile": "cruise", "target_alt": 25000, "r": "84-0180",
        "desc": "Beechcraft C-12 Huron",
    },
    {
        "hex": "ADF001", "flight": "        ", "category": "A5", "t": "K35R",
        "dbFlags": 1, "profile": "holding", "target_alt": 26000, "r": "63-8877",
        "desc": "Boeing KC-135R Stratotanker",
    },
    # Business jets
    {
        "hex": "A33333", "flight": "N333BJ  ", "category": "A2", "t": "GLF5",
        "dbFlags": 0, "profile": "cruise", "target_alt": 45000, "r": "N333BJ",
        "desc": "Gulfstream G550",
    },
    {
        "hex": "A22233", "flight": "N100CL  ", "category": "A2", "t": "CL35",
        "dbFlags": 0, "profile": "climb", "target_alt": 43000, "r": "N100CL",
        "desc": "Bombardier Challenger 350",
    },
    {
        "hex": "A11122", "flight": "EJA123  ", "category": "A2", "t": "C68A",
        "dbFlags": 0, "profile": "descend", "target_alt": 5000, "r": "N123QS",
        "desc": "Cessna Citation Latitude",
    },
    # General aviation
    {
        "hex": "C45678", "flight": "N12345  ", "category": "A1", "t": "C172",
        "dbFlags": 0, "profile": "pattern", "target_alt": 3500, "r": "N12345",
        "desc": "Cessna 172 Skyhawk",
    },
    {
        "hex": "A09876", "flight": "N67890  ", "category": "A1", "t": "P28A",
        "dbFlags": 0, "profile": "cruise", "target_alt": 5500, "r": "N67890",
        "desc": "Piper PA-28 Cherokee",
    },
    {
        "hex": "A08765", "flight": "N54321  ", "category": "A1", "t": "C182",
        "dbFlags": 0, "profile": "cruise", "target_alt": 7500, "r": "N54321",
        "desc": "Cessna 182 Skylane",
    },
    {
        "hex": "A07654", "flight": "N11111  ", "category": "A1", "t": "SR22",
        "dbFlags": 0, "profile": "cruise", "target_alt": 8000, "r": "N11111",
        "desc": "Cirrus SR22",
    },
    # Helicopters
    {
        "hex": "A01234", "flight": "N911AE  ", "category": "A7", "t": "EC35",
        "dbFlags": 0, "profile": "helicopter", "target_alt": 1500, "r": "N911AE",
        "desc": "Eurocopter EC135 (Air Ambulance)",
    },
    {
        "hex": "A02345", "flight": "N206TV  ", "category": "A7", "t": "A109",
        "dbFlags": 0, "profile": "helicopter", "target_alt": 2000, "r": "N206TV",
        "desc": "AgustaWestland AW109 (News)",
    },
    {
        "hex": "AE0001", "flight": "GUARD1  ", "category": "A7", "t": "H60",
        "dbFlags": 1, "profile": "helicopter", "target_alt": 500, "r": "16-20901",
        "desc": "Sikorsky UH-60 Black Hawk",
    },
    # Emergency test aircraft
    {
        "hex": "A88888", "flight": "N7700E  ", "category": "A1", "t": "C182",
        "dbFlags": 0, "profile": "descend", "target_alt": 3000, "squawk": "7700",
        "r": "N7700E", "desc": "Cessna 182 (EMERGENCY)",
    },
    {
        "hex": "A99999", "flight": "UAL999  ", "category": "A3", "t": "B738",
        "dbFlags": 0, "profile": "cruise", "target_alt": 25000, "squawk": "7600",
        "r": "N999UA", "desc": "Boeing 737-800 (NORDO)",
    },
    # Interesting callsigns
    {
        "hex": "A50001", "flight": "BLOCKED ", "category": "A2", "t": "GLEX",
        "dbFlags": 8, "profile": "cruise", "target_alt": 45000, "r": "",
        "desc": "Bombardier Global Express (PIA)",
    },
    {
        "hex": "A60001", "flight": "LXJ523  ", "category": "A2", "t": "E55P",
        "dbFlags": 0, "profile": "cruise", "target_alt": 43000, "r": "N523FX",
        "desc": "Embraer Phenom 300",
    },
    # Ground vehicle (for airport testing)
    {
        "hex": "A00001", "flight": "SEATAC1 ", "category": "C2", "t": "GRND",
        "dbFlags": 0, "profile": "ground", "target_alt": 0, "r": "VEHICLE",
        "desc": "Airport Ground Vehicle",
    },
    # =========================================================================
    # CONFLICT TEST AIRCRAFT - Pairs designed to trigger proximity alerts
    # =========================================================================
    # Conflict Pair 1: Two aircraft converging at FL350
    {
        "hex": "CF1001", "flight": "TEST01A ", "category": "A3", "t": "B738",
        "dbFlags": 0, "profile": "conflict_converge", "target_alt": 35000,
        "r": "N101CF", "desc": "Conflict Test - Pair 1A (converging)",
        "conflict_pair": "CF1002", "conflict_type": "converging",
    },
    {
        "hex": "CF1002", "flight": "TEST01B ", "category": "A3", "t": "A320",
        "dbFlags": 0, "profile": "conflict_converge", "target_alt": 35000,
        "r": "N102CF", "desc": "Conflict Test - Pair 1B (converging)",
        "conflict_pair": "CF1001", "conflict_type": "converging",
    },
    # Conflict Pair 2: Parallel tracks, same altitude - will drift together
    {
        "hex": "CF2001", "flight": "TEST02A ", "category": "A3", "t": "B739",
        "dbFlags": 0, "profile": "conflict_parallel", "target_alt": 38000,
        "r": "N201CF", "desc": "Conflict Test - Pair 2A (parallel drift)",
        "conflict_pair": "CF2002", "conflict_type": "parallel",
    },
    {
        "hex": "CF2002", "flight": "TEST02B ", "category": "A3", "t": "A321",
        "dbFlags": 0, "profile": "conflict_parallel", "target_alt": 38000,
        "r": "N202CF", "desc": "Conflict Test - Pair 2B (parallel drift)",
        "conflict_pair": "CF2001", "conflict_type": "parallel",
    },
    # Conflict Pair 3: Climbing aircraft vs cruise - altitude bust
    {
        "hex": "CF3001", "flight": "TEST03A ", "category": "A3", "t": "B738",
        "dbFlags": 0, "profile": "conflict_climb", "target_alt": 36000,
        "r": "N301CF", "desc": "Conflict Test - Pair 3A (climbing through)",
        "conflict_pair": "CF3002", "conflict_type": "vertical",
    },
    {
        "hex": "CF3002", "flight": "TEST03B ", "category": "A3", "t": "A320",
        "dbFlags": 0, "profile": "cruise", "target_alt": 34000,
        "r": "N302CF", "desc": "Conflict Test - Pair 3B (level, being climbed through)",
        "conflict_pair": "CF3001", "conflict_type": "vertical",
    },
    # Conflict Pair 4: Head-on at same altitude
    {
        "hex": "CF4001", "flight": "TEST04A ", "category": "A3", "t": "B737",
        "dbFlags": 0, "profile": "conflict_headon", "target_alt": 33000,
        "r": "N401CF", "desc": "Conflict Test - Pair 4A (head-on)",
        "conflict_pair": "CF4002", "conflict_type": "headon",
    },
    {
        "hex": "CF4002", "flight": "TEST04B ", "category": "A3", "t": "A319",
        "dbFlags": 0, "profile": "conflict_headon", "target_alt": 33000,
        "r": "N402CF", "desc": "Conflict Test - Pair 4B (head-on)",
        "conflict_pair": "CF4001", "conflict_type": "headon",
    },
    # Conflict Pair 5: Descending into traffic
    {
        "hex": "CF5001", "flight": "TEST05A ", "category": "A3", "t": "B738",
        "dbFlags": 0, "profile": "conflict_descend", "target_alt": 28000,
        "r": "N501CF", "desc": "Conflict Test - Pair 5A (descending into)",
        "conflict_pair": "CF5002", "conflict_type": "vertical",
    },
    {
        "hex": "CF5002", "flight": "TEST05B ", "category": "A3", "t": "A320",
        "dbFlags": 0, "profile": "cruise", "target_alt": 30000,
        "r": "N502CF", "desc": "Conflict Test - Pair 5B (level, being descended into)",
        "conflict_pair": "CF5001", "conflict_type": "vertical",
    },
    # Conflict Pair 6: Low altitude GA conflict
    {
        "hex": "CF6001", "flight": "N600CF  ", "category": "A1", "t": "C172",
        "dbFlags": 0, "profile": "conflict_pattern", "target_alt": 3500,
        "r": "N600CF", "desc": "Conflict Test - Pair 6A (pattern conflict)",
        "conflict_pair": "CF6002", "conflict_type": "pattern",
    },
    {
        "hex": "CF6002", "flight": "N601CF  ", "category": "A1", "t": "PA28",
        "dbFlags": 0, "profile": "conflict_pattern", "target_alt": 3500,
        "r": "N601CF", "desc": "Conflict Test - Pair 6B (pattern conflict)",
        "conflict_pair": "CF6001", "conflict_type": "pattern",
    },
]

# Emergency squawk codes for testing
EMERGENCY_SQUAWKS = [
    "7500",  # Hijack
    "7600",  # Radio failure (NORDO)
    "7700",  # General emergency
]


def generate_squawk():
    """Generate a squawk code, with occasional emergency codes for testing"""
    roll = random.random()
    if roll < 0.05:  # 5% chance of emergency squawk
        return random.choice(EMERGENCY_SQUAWKS)
    elif roll < 0.15:  # 10% chance of discrete code (IFR)
        return str(random.randint(1000, 6777)).zfill(4)
    else:  # 85% VFR squawk
        return "1200"

UAT_TEMPLATES = [
    {
        "hex": "A11111", "flight": "N98765  ", "category": "A1", "t": "C152",
        "dbFlags": 0, "profile": "pattern", "target_alt": 3000, "r": "N98765",
        "desc": "Cessna 152",
    },
    {
        "hex": "A22222", "flight": "N54321  ", "category": "A1", "t": "PA28",
        "dbFlags": 0, "profile": "cruise", "target_alt": 5500, "r": "N54321",
        "desc": "Piper PA-28 Cherokee",
    },
    {
        "hex": "A33344", "flight": "N11223  ", "category": "A1", "t": "C182",
        "dbFlags": 0, "profile": "climb", "target_alt": 7500, "r": "N11223",
        "desc": "Cessna 182 Skylane",
    },
    {
        "hex": "A44455", "flight": "N22334  ", "category": "A1", "t": "PA32",
        "dbFlags": 0, "profile": "cruise", "target_alt": 6500, "r": "N22334",
        "desc": "Piper PA-32 Cherokee Six",
    },
    {
        "hex": "A55566", "flight": "N33445  ", "category": "A1", "t": "BE36",
        "dbFlags": 0, "profile": "cruise", "target_alt": 8000, "r": "N33445",
        "desc": "Beechcraft Bonanza",
    },
]


def get_aircraft_performance(aircraft_type):
    """Return realistic performance parameters for aircraft type"""
    performance = {
        # Narrow-body airliners
        "B738": {"cruise_speed": 450, "climb_speed": 280, "descent_speed": 300, "climb_rate": 2000, "descent_rate": 1500, "max_alt": 41000},
        "B739": {"cruise_speed": 450, "climb_speed": 280, "descent_speed": 300, "climb_rate": 2000, "descent_rate": 1500, "max_alt": 41000},
        "B737": {"cruise_speed": 450, "climb_speed": 280, "descent_speed": 300, "climb_rate": 2000, "descent_rate": 1500, "max_alt": 41000},
        "A321": {"cruise_speed": 450, "climb_speed": 290, "descent_speed": 310, "climb_rate": 2200, "descent_rate": 1600, "max_alt": 39000},
        "A320": {"cruise_speed": 450, "climb_speed": 290, "descent_speed": 310, "climb_rate": 2200, "descent_rate": 1600, "max_alt": 39000},
        # Wide-body airliners
        "B77W": {"cruise_speed": 490, "climb_speed": 300, "descent_speed": 320, "climb_rate": 2500, "descent_rate": 1800, "max_alt": 43000},
        "B748": {"cruise_speed": 490, "climb_speed": 280, "descent_speed": 300, "climb_rate": 2000, "descent_rate": 1500, "max_alt": 43000},
        "B763": {"cruise_speed": 470, "climb_speed": 290, "descent_speed": 310, "climb_rate": 2200, "descent_rate": 1600, "max_alt": 43000},
        "A359": {"cruise_speed": 490, "climb_speed": 300, "descent_speed": 320, "climb_rate": 2400, "descent_rate": 1700, "max_alt": 43000},
        # Military transports
        "C17":  {"cruise_speed": 400, "climb_speed": 250, "descent_speed": 280, "climb_rate": 2800, "descent_rate": 2000, "max_alt": 45000},
        "C130": {"cruise_speed": 320, "climb_speed": 200, "descent_speed": 220, "climb_rate": 1800, "descent_rate": 1500, "max_alt": 28000},
        "C12":  {"cruise_speed": 270, "climb_speed": 180, "descent_speed": 200, "climb_rate": 2000, "descent_rate": 1500, "max_alt": 35000},
        "K35R": {"cruise_speed": 460, "climb_speed": 280, "descent_speed": 300, "climb_rate": 2000, "descent_rate": 1500, "max_alt": 50000},
        # Business jets
        "GLF5": {"cruise_speed": 480, "climb_speed": 300, "descent_speed": 320, "climb_rate": 3500, "descent_rate": 2500, "max_alt": 51000},
        "GLEX": {"cruise_speed": 480, "climb_speed": 300, "descent_speed": 320, "climb_rate": 3500, "descent_rate": 2500, "max_alt": 51000},
        "CL35": {"cruise_speed": 450, "climb_speed": 290, "descent_speed": 300, "climb_rate": 3200, "descent_rate": 2200, "max_alt": 45000},
        "C68A": {"cruise_speed": 420, "climb_speed": 260, "descent_speed": 280, "climb_rate": 3000, "descent_rate": 2000, "max_alt": 45000},
        "E55P": {"cruise_speed": 420, "climb_speed": 260, "descent_speed": 280, "climb_rate": 3000, "descent_rate": 2000, "max_alt": 45000},
        # General aviation - piston
        "C172": {"cruise_speed": 110, "climb_speed": 80, "descent_speed": 90, "climb_rate": 700, "descent_rate": 500, "max_alt": 14000},
        "C152": {"cruise_speed": 95, "climb_speed": 70, "descent_speed": 80, "climb_rate": 600, "descent_rate": 500, "max_alt": 12000},
        "C182": {"cruise_speed": 140, "climb_speed": 90, "descent_speed": 100, "climb_rate": 900, "descent_rate": 600, "max_alt": 18000},
        "PA28": {"cruise_speed": 115, "climb_speed": 85, "descent_speed": 95, "climb_rate": 650, "descent_rate": 500, "max_alt": 14000},
        "P28A": {"cruise_speed": 115, "climb_speed": 85, "descent_speed": 95, "climb_rate": 650, "descent_rate": 500, "max_alt": 14000},
        "PA32": {"cruise_speed": 140, "climb_speed": 90, "descent_speed": 100, "climb_rate": 800, "descent_rate": 600, "max_alt": 16000},
        "BE36": {"cruise_speed": 170, "climb_speed": 110, "descent_speed": 120, "climb_rate": 1000, "descent_rate": 700, "max_alt": 18000},
        "SR22": {"cruise_speed": 175, "climb_speed": 110, "descent_speed": 120, "climb_rate": 1200, "descent_rate": 800, "max_alt": 17500},
        # Helicopters
        "EC35": {"cruise_speed": 135, "climb_speed": 80, "descent_speed": 80, "climb_rate": 1500, "descent_rate": 1200, "max_alt": 15000},
        "A109": {"cruise_speed": 150, "climb_speed": 90, "descent_speed": 90, "climb_rate": 1800, "descent_rate": 1500, "max_alt": 18000},
        "H60":  {"cruise_speed": 150, "climb_speed": 80, "descent_speed": 80, "climb_rate": 1400, "descent_rate": 1200, "max_alt": 19000},
        # Ground
        "GRND": {"cruise_speed": 25, "climb_speed": 0, "descent_speed": 0, "climb_rate": 0, "descent_rate": 0, "max_alt": 0},
    }
    return performance.get(aircraft_type, {"cruise_speed": 200, "climb_speed": 150, "descent_speed": 170, "climb_rate": 1000, "descent_rate": 800, "max_alt": 25000})


def nm_to_degrees_lat(nm):
    """Convert nautical miles to degrees latitude"""
    return nm / 60.0


def nm_to_degrees_lon(nm, lat):
    """Convert nautical miles to degrees longitude at given latitude"""
    return nm / (60.0 * math.cos(math.radians(lat)))


def calculate_distance_nm(lat1, lon1, lat2, lon2):
    """Calculate distance in nautical miles between two points"""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return 3440.065 * c  # Earth radius in NM


def detect_conflicts(aircraft_dict: Dict[str, dict]) -> List[dict]:
    """
    Detect proximity conflicts between aircraft.
    
    Conflict criteria:
    - Horizontal separation < 3nm
    - Vertical separation < 1000ft
    - Both conditions must be true
    
    Returns list of conflict records.
    """
    conflicts = []
    aircraft_list = list(aircraft_dict.values())
    
    for i, ac1 in enumerate(aircraft_list):
        # Skip ground vehicles
        if ac1.get("profile") == "ground":
            continue
            
        for ac2 in aircraft_list[i+1:]:
            # Skip ground vehicles
            if ac2.get("profile") == "ground":
                continue
            
            # Calculate horizontal separation
            horiz_sep_nm = calculate_distance_nm(
                ac1["lat"], ac1["lon"],
                ac2["lat"], ac2["lon"]
            )
            
            # Calculate vertical separation
            alt1 = ac1.get("alt_baro", 0) or 0
            alt2 = ac2.get("alt_baro", 0) or 0
            vert_sep_ft = abs(alt1 - alt2)
            
            # Check if both thresholds are violated
            if horiz_sep_nm < CONFLICT_HORIZONTAL_NM and vert_sep_ft < CONFLICT_VERTICAL_FT:
                # Calculate closure rate (approximate)
                # Positive = getting closer, negative = diverging
                track1_rad = math.radians(ac1.get("track", 0))
                track2_rad = math.radians(ac2.get("track", 0))
                gs1 = ac1.get("gs", 0)
                gs2 = ac2.get("gs", 0)
                
                # Velocity components
                vx1 = gs1 * math.sin(track1_rad)
                vy1 = gs1 * math.cos(track1_rad)
                vx2 = gs2 * math.sin(track2_rad)
                vy2 = gs2 * math.cos(track2_rad)
                
                # Relative velocity
                rel_vx = vx2 - vx1
                rel_vy = vy2 - vy1
                
                # Direction from ac1 to ac2
                dx = ac2["lon"] - ac1["lon"]
                dy = ac2["lat"] - ac1["lat"]
                dist = math.sqrt(dx*dx + dy*dy)
                
                if dist > 0:
                    # Closure rate (positive = closing)
                    closure_rate = -(rel_vx * dx + rel_vy * dy) / dist
                else:
                    closure_rate = 0
                
                # Vertical closure
                vrate1 = ac1.get("baro_rate", 0) or 0
                vrate2 = ac2.get("baro_rate", 0) or 0
                vert_closure = abs(vrate1 - vrate2)  # fpm difference
                
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
                    "aircraft1": {
                        "hex": ac1["hex"],
                        "flight": ac1.get("flight", "").strip(),
                        "lat": round(ac1["lat"], 5),
                        "lon": round(ac1["lon"], 5),
                        "alt_baro": int(alt1),
                        "gs": round(gs1, 1),
                        "track": round(ac1.get("track", 0), 1),
                        "baro_rate": int(vrate1),
                    },
                    "aircraft2": {
                        "hex": ac2["hex"],
                        "flight": ac2.get("flight", "").strip(),
                        "lat": round(ac2["lat"], 5),
                        "lon": round(ac2["lon"], 5),
                        "alt_baro": int(alt2),
                        "gs": round(gs2, 1),
                        "track": round(ac2.get("track", 0), 1),
                        "baro_rate": int(vrate2),
                    },
                    "separation": {
                        "horizontal_nm": round(horiz_sep_nm, 2),
                        "vertical_ft": int(vert_sep_ft),
                    },
                    "dynamics": {
                        "closure_rate_kts": round(closure_rate, 1),
                        "vertical_closure_fpm": int(vert_closure),
                        "converging": closure_rate > 10,
                    },
                    "thresholds": {
                        "horizontal_nm": CONFLICT_HORIZONTAL_NM,
                        "vertical_ft": CONFLICT_VERTICAL_FT,
                    }
                }
                conflicts.append(conflict)
    
    return conflicts


def calculate_ground_speed(true_airspeed, track, wind_direction, wind_speed):
    """Calculate ground speed given TAS, track, and wind"""
    if not ENABLE_WEATHER or wind_speed == 0:
        return true_airspeed
    
    # Wind is direction FROM, convert to direction TO for calculation
    wind_to = (wind_direction + 180) % 360
    
    # Calculate wind correction angle
    track_rad = math.radians(track)
    wind_rad = math.radians(wind_to)
    
    # Head/tail wind component
    wind_component = wind_speed * math.cos(wind_rad - track_rad)
    
    return true_airspeed + wind_component


def calculate_signal_strength(distance_nm, altitude_ft):
    """Calculate realistic RSSI based on distance and altitude"""
    # Better signal for higher altitude (better line of sight)
    alt_factor = min(altitude_ft / 40000, 1.0) * 5  # up to 5dB improvement
    
    # Signal degrades with distance (roughly -6dB per doubling)
    dist_factor = -6 * math.log2(max(distance_nm, 1) / 10)
    
    base_rssi = -20
    rssi = base_rssi + alt_factor + dist_factor
    
    # Add noise and clamp
    rssi += random.uniform(-2, 2)
    return max(-50, min(-5, rssi))


def calculate_mach(tas_kts, altitude_ft):
    """Calculate Mach number from TAS and altitude"""
    # Speed of sound decreases with altitude (simplified)
    if altitude_ft < 36000:
        temp_c = 15 - (altitude_ft / 1000) * 2  # ~2C per 1000ft
    else:
        temp_c = -56.5  # Stratosphere
    
    speed_of_sound = 661.47 * math.sqrt((temp_c + 273.15) / 288.15)
    return tas_kts / speed_of_sound


def get_nav_modes(profile, altitude, target_alt):
    """Get realistic navigation modes based on flight profile"""
    modes = []
    
    if profile in ["cruise", "holding"]:
        modes = ["autopilot", "vnav", "lnav", "tcas"]
    elif profile == "climb":
        modes = ["autopilot", "vnav", "lnav", "tcas"]
        if altitude > 10000:
            modes.append("althold")
    elif profile in ["descend", "approach"]:
        modes = ["autopilot", "vnav", "lnav", "tcas"]
        if altitude < 5000:
            modes.append("approach")
    elif profile == "pattern":
        modes = []
    elif profile == "helicopter":
        modes = ["tcas"] if random.random() > 0.5 else []
    
    return modes


def spawn_aircraft(template, edge_spawn=True):
    """Create a new aircraft state from template"""
    perf = get_aircraft_performance(template["t"])
    profile = template.get("profile", "cruise")
    conflict_type = template.get("conflict_type")
    
    if profile == "ground":
        # Ground vehicles stay near center
        distance = random.uniform(0.5, 2)
        angle = random.uniform(0, 2 * math.pi)
        lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * math.cos(angle))
        lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance * math.sin(angle), COVERAGE_CENTER_LAT)
        track = random.uniform(0, 360)
        alt = 0
        gs = random.uniform(5, 25)
        baro_rate = 0
    elif profile.startswith("conflict_"):
        # Conflict test aircraft - spawn in specific configurations
        alt = template.get("target_alt", 35000)
        baro_rate = 0
        gs = perf["cruise_speed"]
        
        # Determine position based on hex - first of pair or second
        is_first = template["hex"].endswith("01") or template["hex"].endswith("001")
        
        if conflict_type == "converging":
            # Two aircraft converging toward a point
            # Spawn 20-40nm from center, heading toward each other
            distance = random.uniform(25, 40)
            if is_first:
                angle = math.radians(45)  # Northeast
                track = 225  # Heading southwest
            else:
                angle = math.radians(225)  # Southwest
                track = 45  # Heading northeast
            lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * math.cos(angle))
            lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance * math.sin(angle), COVERAGE_CENTER_LAT)
            # Add small altitude variation to ensure conflict
            alt += random.randint(-200, 200)
            
        elif conflict_type == "parallel":
            # Two aircraft on parallel tracks, close together
            distance = random.uniform(20, 35)
            base_angle = math.radians(0)  # Both heading north-ish
            if is_first:
                lat_offset = 0
                lon_offset = nm_to_degrees_lon(1.5, COVERAGE_CENTER_LAT)  # 1.5nm apart
            else:
                lat_offset = nm_to_degrees_lat(2)  # Slightly behind
                lon_offset = 0
            lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance) + lat_offset
            lon = COVERAGE_CENTER_LON + lon_offset
            track = 360 + random.uniform(-5, 5)  # Both heading north
            # One will drift toward the other
            if not is_first:
                track = 355  # Slight westward drift
                
        elif conflict_type == "vertical":
            # One climbing/descending through another's altitude
            distance = random.uniform(15, 25)
            angle = math.radians(90)  # East of center
            if is_first:
                # Climbing aircraft
                alt = template.get("target_alt", 35000) - 3000  # Start 3000ft below target
                baro_rate = perf["climb_rate"]
                lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * 0.5)
                lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance, COVERAGE_CENTER_LAT)
            else:
                # Level aircraft in the way
                lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * 0.5 + 1)
                lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance + 2, COVERAGE_CENTER_LAT)
            track = 270 + random.uniform(-10, 10)  # Heading west
            
        elif conflict_type == "headon":
            # Two aircraft head-on
            distance = random.uniform(30, 50)
            if is_first:
                lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance)
                lon = COVERAGE_CENTER_LON
                track = 180  # Heading south
            else:
                lat = COVERAGE_CENTER_LAT - nm_to_degrees_lat(distance)
                lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(0.5, COVERAGE_CENTER_LAT)  # Slight offset
                track = 0  # Heading north
            alt += random.randint(-300, 300)
            
        elif conflict_type == "pattern":
            # GA aircraft in traffic pattern conflict
            distance = random.uniform(3, 8)
            if is_first:
                angle = math.radians(0)
                track = 270  # Downwind
            else:
                angle = math.radians(180)
                track = 90  # Base leg
            lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * math.cos(angle))
            lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance * math.sin(angle), COVERAGE_CENTER_LAT)
            alt += random.randint(-200, 200)
            gs = perf["cruise_speed"] * 0.7
            
        else:
            # Default conflict - random close positioning
            distance = random.uniform(10, 30)
            angle = random.uniform(0, 2 * math.pi)
            lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * math.cos(angle))
            lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance * math.sin(angle), COVERAGE_CENTER_LAT)
            track = random.uniform(0, 360)
            
    elif edge_spawn and profile not in ["pattern", "helicopter", "holding"]:
        # Spawn at edge of coverage, heading toward center
        angle = random.uniform(0, 2 * math.pi)
        spawn_distance = COVERAGE_RADIUS_NM * random.uniform(0.85, 0.95)
        lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(spawn_distance * math.cos(angle))
        lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(spawn_distance * math.sin(angle), COVERAGE_CENTER_LAT)
        
        # Head generally toward center with some variation
        base_track = math.degrees(math.atan2(
            COVERAGE_CENTER_LON - lon,
            COVERAGE_CENTER_LAT - lat
        ))
        track = (base_track + random.uniform(-30, 30)) % 360
        
        # Set initial altitude and rate based on profile
        if profile == "climb":
            alt = random.randint(5000, 15000)
            baro_rate = perf["climb_rate"] + random.randint(-200, 200)
            gs = perf["climb_speed"] + random.randint(-10, 10)
        elif profile == "descend":
            alt = random.randint(15000, 30000)
            baro_rate = -perf["descent_rate"] + random.randint(-200, 200)
            gs = perf["descent_speed"] + random.randint(-10, 10)
        else:  # cruise
            alt = template.get("target_alt", 35000) + random.randint(-1000, 1000)
            baro_rate = random.randint(-100, 100)
            gs = perf["cruise_speed"] + random.randint(-20, 20)
    else:
        # Spawn within coverage area (for pattern, helicopter, holding, or initial population)
        if profile in ["pattern", "helicopter"]:
            distance = random.uniform(5, 30)  # Close to center for local traffic
        elif profile == "holding":
            distance = random.uniform(30, 60)  # Holding patterns
        else:
            distance = COVERAGE_RADIUS_NM * random.uniform(0.1, 0.7)
            
        angle = random.uniform(0, 2 * math.pi)
        lat = COVERAGE_CENTER_LAT + nm_to_degrees_lat(distance * math.cos(angle))
        lon = COVERAGE_CENTER_LON + nm_to_degrees_lon(distance * math.sin(angle), COVERAGE_CENTER_LAT)
        track = random.uniform(0, 360)
        
        if profile == "helicopter":
            alt = template.get("target_alt", 1500) + random.randint(-300, 300)
            baro_rate = random.randint(-200, 200)
            gs = perf["cruise_speed"] * random.uniform(0.3, 1.0)  # Helicopters vary speed
        elif profile == "holding":
            alt = template.get("target_alt", 10000) + random.randint(-500, 500)
            baro_rate = random.randint(-100, 100)
            gs = perf["cruise_speed"] * 0.7  # Slower in holding
        elif profile == "pattern":
            alt = template.get("target_alt", 3000) + random.randint(-500, 500)
            baro_rate = random.randint(-200, 200)
            gs = perf["cruise_speed"] * 0.8 + random.randint(-10, 10)
        else:
            alt = template.get("target_alt", 35000) + random.randint(-1000, 1000)
            baro_rate = random.randint(-100, 100)
            gs = perf["cruise_speed"] + random.randint(-20, 20)
    
    # Calculate TAS from groundspeed (reverse wind effect for realism)
    tas = gs - random.uniform(-10, 10) if ENABLE_WEATHER else gs
    
    # Calculate Mach for high-altitude aircraft
    mach = calculate_mach(tas, alt) if alt > 25000 else None
    
    # Calculate realistic RSSI
    distance_from_receiver = calculate_distance_nm(COVERAGE_CENTER_LAT, COVERAGE_CENTER_LON, lat, lon)
    rssi = calculate_signal_strength(distance_from_receiver, alt)
    
    # NIC/NAC integrity values (simulated - higher is better)
    nic = random.choice([7, 8, 8, 8, 9, 9])  # Navigation Integrity Category
    nac_p = random.choice([8, 9, 9, 10, 10])  # Navigation Accuracy Category - Position
    nac_v = random.choice([1, 2, 2, 2])  # Navigation Accuracy Category - Velocity
    sil = random.choice([2, 3, 3])  # Source Integrity Level
    
    aircraft = {
        "hex": template["hex"],
        "flight": template["flight"],
        "r": template.get("r", ""),  # Registration
        "t": template["t"],  # Type
        "desc": template.get("desc", ""),  # Description
        "lat": lat,
        "lon": lon,
        "alt_baro": alt,
        "alt_geom": alt + random.randint(50, 150),
        "gs": gs,
        "tas": tas,
        "track": track,
        "track_rate": 0.0,  # Degrees per second
        "baro_rate": baro_rate,
        "geom_rate": baro_rate + random.randint(-50, 50),
        "squawk": template.get("squawk") or generate_squawk(),
        "category": template["category"],
        "nav_qnh": random.choice([1013.2, 1013.25, round(random.uniform(1010, 1020), 2)]),
        "nav_altitude_mcp": template.get("target_alt", alt),
        "nav_heading": track + random.uniform(-5, 5),
        "nav_modes": get_nav_modes(profile, alt, template.get("target_alt", alt)),
        "nic": nic,
        "rc": [0, 7.5, 25, 75, 185, 370, 926, 1852, 3704, 7408, 14816][min(nic, 10)],
        "nac_p": nac_p,
        "nac_v": nac_v,
        "sil": sil,
        "sil_type": "perhour",
        "gva": random.choice([1, 2, 2]),
        "sda": random.choice([1, 2, 2]),
        "alert": 0,
        "spi": 0,  # Special Position Identification
        "rssi": rssi,
        "dbFlags": template["dbFlags"],
        "seen": 0.0,
        "seen_pos": 0.0,
        "messages": random.randint(100, 1000),
        "profile": profile,
        "target_alt": template.get("target_alt", alt),
        "turn_timer": random.uniform(30, 120),
        "last_update": time.time(),
        "holding_fix_lat": lat if profile == "holding" else None,
        "holding_fix_lon": lon if profile == "holding" else None,
        "holding_inbound": random.randint(0, 359) if profile == "holding" else None,
    }
    
    # Add Mach if applicable
    if mach and mach > 0.4:
        aircraft["mach"] = round(mach, 3)
    
    # Add IAS (simplified estimate from TAS)
    if alt > 0:
        # Rough IAS approximation (TAS decreases ~2% per 1000ft)
        ias = tas / (1 + 0.02 * (alt / 1000))
        aircraft["ias"] = round(ias)
    
    return aircraft


def update_aircraft_position(ac, dt):
    """Update aircraft position based on speed, heading, and time elapsed"""
    global message_count
    
    if dt <= 0:
        return ac
    
    perf = get_aircraft_performance(ac["t"])
    profile = ac.get("profile", "cruise")
    
    # Ground vehicles
    if profile == "ground":
        # Slow random movement
        ac["turn_timer"] -= dt
        if ac["turn_timer"] <= 0:
            ac["track"] = (ac["track"] + random.uniform(-45, 45)) % 360
            ac["gs"] = random.uniform(5, 25)
            ac["turn_timer"] = random.uniform(10, 30)
        
        distance_nm = (ac["gs"] / 3600.0) * dt
        track_rad = math.radians(ac["track"])
        dlat = distance_nm * math.cos(track_rad)
        dlon = distance_nm * math.sin(track_rad)
        ac["lat"] += nm_to_degrees_lat(dlat)
        ac["lon"] += nm_to_degrees_lon(dlon, ac["lat"])
        ac["last_update"] = time.time()
        ac["messages"] = ac.get("messages", 0) + random.randint(1, 5)
        message_count += random.randint(1, 5)
        return ac
    
    # Calculate turn rate for track_rate field
    old_track = ac["track"]
    
    # Update position based on ground speed and track
    distance_nm = (ac["gs"] / 3600.0) * dt
    
    track_rad = math.radians(ac["track"])
    dlat = distance_nm * math.cos(track_rad)
    dlon = distance_nm * math.sin(track_rad)
    
    ac["lat"] += nm_to_degrees_lat(dlat)
    ac["lon"] += nm_to_degrees_lon(dlon, ac["lat"])
    
    # Update altitude based on baro_rate (feet per minute)
    alt_change = (ac["baro_rate"] / 60.0) * dt
    ac["alt_baro"] += alt_change
    ac["alt_geom"] = ac["alt_baro"] + random.randint(50, 150)
    
    # Adjust climb/descent rate based on profile and target
    target_alt = ac.get("target_alt", ac["alt_baro"])
    alt_diff = target_alt - ac["alt_baro"]
    
    if profile == "climb":
        if alt_diff > 500:
            ac["baro_rate"] = perf["climb_rate"] + random.randint(-100, 100)
            ac["gs"] = perf["climb_speed"] + random.randint(-5, 5)
        else:
            # Level off
            ac["profile"] = "cruise"
            ac["baro_rate"] = random.randint(-50, 50)
            ac["alt_baro"] = target_alt
            ac["gs"] = perf["cruise_speed"] + random.randint(-10, 10)
            
    elif profile == "descend":
        if alt_diff < -500:
            ac["baro_rate"] = -perf["descent_rate"] + random.randint(-100, 100)
            ac["gs"] = perf["descent_speed"] + random.randint(-5, 5)
        else:
            ac["baro_rate"] = random.randint(-200, 0)
            ac["alt_baro"] = max(ac["alt_baro"], 1000)
            
    elif profile == "pattern":
        # VFR pattern - left traffic turns
        ac["turn_timer"] -= dt
        if ac["turn_timer"] <= 0:
            ac["track"] = (ac["track"] - 90 + random.uniform(-10, 10)) % 360
            ac["turn_timer"] = random.uniform(45, 90)
            ac["target_alt"] = ac.get("target_alt", 3000) + random.randint(-200, 200)
            ac["baro_rate"] = random.randint(-300, 300)
            
    elif profile == "holding":
        # Racetrack holding pattern
        ac["turn_timer"] -= dt
        if ac["turn_timer"] <= 0:
            # Alternate between inbound/outbound legs and turns
            current_phase = ac.get("holding_phase", 0)
            if current_phase == 0:  # End of inbound, start right turn
                ac["track"] = (ac["track"] + 180) % 360
                ac["turn_timer"] = random.uniform(55, 65)  # 1 minute leg
                ac["holding_phase"] = 1
            elif current_phase == 1:  # End of outbound, start right turn
                ac["track"] = ac.get("holding_inbound", ac["track"])
                ac["turn_timer"] = random.uniform(55, 65)
                ac["holding_phase"] = 0
        ac["baro_rate"] = random.randint(-100, 100)
        
    elif profile == "helicopter":
        # Helicopter - can hover, make sudden turns, vary altitude
        ac["turn_timer"] -= dt
        if ac["turn_timer"] <= 0:
            # Random maneuver
            maneuver = random.choice(["turn", "altitude", "speed", "hover"])
            if maneuver == "turn":
                ac["track"] = (ac["track"] + random.uniform(-90, 90)) % 360
            elif maneuver == "altitude":
                ac["target_alt"] = ac.get("target_alt", 1500) + random.randint(-500, 500)
                ac["target_alt"] = max(200, min(5000, ac["target_alt"]))
                ac["baro_rate"] = random.randint(-800, 800)
            elif maneuver == "speed":
                ac["gs"] = perf["cruise_speed"] * random.uniform(0.1, 1.0)
            else:  # hover
                ac["gs"] = random.uniform(0, 20)
            ac["turn_timer"] = random.uniform(15, 45)
        
        # Altitude adjustment
        if abs(ac["alt_baro"] - ac.get("target_alt", 1500)) > 100:
            ac["baro_rate"] = 500 if ac["alt_baro"] < ac["target_alt"] else -500
        else:
            ac["baro_rate"] = random.randint(-100, 100)
    
    elif profile.startswith("conflict_"):
        # Conflict test profiles - maintain convergent paths
        conflict_subtype = profile.replace("conflict_", "")
        
        if conflict_subtype == "converge":
            # Keep heading toward center to maintain conflict
            ac["turn_timer"] -= dt
            if ac["turn_timer"] <= 0:
                # Small heading adjustments to stay on collision course
                ac["track"] = (ac["track"] + random.uniform(-2, 2)) % 360
                ac["turn_timer"] = random.uniform(30, 60)
            # Maintain altitude band
            if abs(ac["alt_baro"] - target_alt) > 300:
                ac["baro_rate"] = 500 if ac["alt_baro"] < target_alt else -500
            else:
                ac["baro_rate"] = random.randint(-100, 100)
                
        elif conflict_subtype == "parallel":
            # Drift slightly toward partner
            ac["turn_timer"] -= dt
            if ac["turn_timer"] <= 0:
                # Drift 1-2 degrees toward conflict
                drift = random.uniform(0.5, 1.5)
                if ac["hex"].endswith("02") or ac["hex"].endswith("002"):
                    drift = -drift  # Other aircraft drifts opposite
                ac["track"] = (ac["track"] + drift) % 360
                ac["turn_timer"] = random.uniform(20, 40)
            ac["baro_rate"] = random.randint(-50, 50)
            
        elif conflict_subtype == "climb":
            # Keep climbing through traffic
            if alt_diff > 200:
                ac["baro_rate"] = perf["climb_rate"] + random.randint(-100, 100)
            else:
                # Reset to climb again
                ac["target_alt"] = ac["alt_baro"] + 4000
                ac["baro_rate"] = perf["climb_rate"]
                
        elif conflict_subtype == "descend":
            # Keep descending through traffic
            if alt_diff < -200:
                ac["baro_rate"] = -perf["descent_rate"] + random.randint(-100, 100)
            else:
                # Reset to descend again
                ac["target_alt"] = ac["alt_baro"] - 4000
                ac["baro_rate"] = -perf["descent_rate"]
                
        elif conflict_subtype == "headon":
            # Maintain head-on course with small variations
            ac["turn_timer"] -= dt
            if ac["turn_timer"] <= 0:
                ac["track"] = (ac["track"] + random.uniform(-1, 1)) % 360
                ac["turn_timer"] = random.uniform(30, 60)
            ac["baro_rate"] = random.randint(-50, 50)
            
        elif conflict_subtype == "pattern":
            # GA pattern conflict - keep circling
            ac["turn_timer"] -= dt
            if ac["turn_timer"] <= 0:
                ac["track"] = (ac["track"] - 45 + random.uniform(-5, 5)) % 360
                ac["turn_timer"] = random.uniform(20, 40)
            ac["baro_rate"] = random.randint(-100, 100)
            
    else:
        # Cruise - occasional small heading adjustments
        ac["turn_timer"] -= dt
        if ac["turn_timer"] <= 0:
            ac["track"] = (ac["track"] + random.uniform(-5, 5)) % 360
            ac["turn_timer"] = random.uniform(60, 180)
            ac["baro_rate"] = random.randint(-50, 50)
    
    # Clamp altitude
    max_alt = perf.get("max_alt", 45000)
    ac["alt_baro"] = max(0 if profile == "helicopter" else 500, min(max_alt, ac["alt_baro"]))
    
    # Update derived fields
    ac["gs"] += random.uniform(-0.5, 0.5)
    ac["gs"] = max(0 if profile == "helicopter" else 50, ac["gs"])
    
    # TAS and Mach updates
    ac["tas"] = ac["gs"] + random.uniform(-5, 5)
    if ac["alt_baro"] > 25000:
        ac["mach"] = round(calculate_mach(ac["tas"], ac["alt_baro"]), 3)
    
    # IAS update
    if ac["alt_baro"] > 0:
        ac["ias"] = round(ac["tas"] / (1 + 0.02 * (ac["alt_baro"] / 1000)))
    
    # Track rate (degrees per second)
    track_change = (ac["track"] - old_track + 180) % 360 - 180  # Normalize to -180 to 180
    ac["track_rate"] = round(track_change / max(dt, 0.1), 2)
    
    # Geom rate follows baro rate
    ac["geom_rate"] = ac["baro_rate"] + random.randint(-50, 50)
    
    # Nav heading follows track with slight lag
    ac["nav_heading"] = ac["track"] + random.uniform(-2, 2)
    
    # Update RSSI based on distance
    distance_from_receiver = calculate_distance_nm(COVERAGE_CENTER_LAT, COVERAGE_CENTER_LON, ac["lat"], ac["lon"])
    ac["rssi"] = calculate_signal_strength(distance_from_receiver, ac["alt_baro"])
    
    # Timing fields
    ac["seen"] = random.uniform(0.1, 1.5)
    ac["seen_pos"] = ac["seen"] + random.uniform(0.1, 0.5)
    ac["last_update"] = time.time()
    
    # Message count
    msgs = random.randint(5, 20)
    ac["messages"] = ac.get("messages", 0) + msgs
    message_count += msgs
    
    return ac


def is_in_coverage(ac):
    """Check if aircraft is within coverage area"""
    distance = calculate_distance_nm(
        COVERAGE_CENTER_LAT, COVERAGE_CENTER_LON,
        ac["lat"], ac["lon"]
    )
    return distance < COVERAGE_RADIUS_NM


def initialize_aircraft_state(templates, state_dict, count=None):
    """Initialize aircraft state from templates"""
    if count is None:
        count = len(templates)
    
    for i, template in enumerate(templates[:count]):
        # First batch spawns within coverage, rest at edges
        edge_spawn = i >= count // 2
        state_dict[template["hex"]] = spawn_aircraft(template, edge_spawn=edge_spawn)


def update_all_aircraft(templates, state_dict):
    """Update all aircraft positions and handle respawning"""
    global last_update_time
    
    current_time = time.time()
    dt = current_time - last_update_time
    
    # Cap dt to avoid huge jumps if server was idle
    dt = min(dt, 5.0)
    
    # Initialize if empty
    if not state_dict:
        initialize_aircraft_state(templates, state_dict)
        last_update_time = current_time
        return
    
    # Update each aircraft
    hexes_to_respawn = []
    for hex_code, ac in list(state_dict.items()):
        ac = update_aircraft_position(ac, dt)
        state_dict[hex_code] = ac
        
        # Check if aircraft left coverage area
        if not is_in_coverage(ac):
            hexes_to_respawn.append(hex_code)
    
    # Respawn aircraft that left coverage
    for hex_code in hexes_to_respawn:
        template = next((t for t in templates if t["hex"] == hex_code), None)
        if template:
            state_dict[hex_code] = spawn_aircraft(template, edge_spawn=True)
    
    last_update_time = current_time


def get_aircraft_json(state_dict):
    """Convert state dict to JSON-serializable aircraft list"""
    aircraft = []
    for ac in state_dict.values():
        # Create a clean copy without internal tracking fields
        ac_out = {
            "hex": ac["hex"],
            "flight": ac["flight"],
            "r": ac.get("r", ""),
            "t": ac["t"],
            "desc": ac.get("desc", ""),
            "lat": round(ac["lat"], 6),
            "lon": round(ac["lon"], 6),
            "alt_baro": int(ac["alt_baro"]) if ac["alt_baro"] else "ground",
            "alt_geom": int(ac["alt_geom"]) if ac.get("alt_geom") else None,
            "gs": round(ac["gs"], 1),
            "tas": round(ac.get("tas", ac["gs"]), 1),
            "track": round(ac["track"], 1),
            "track_rate": round(ac.get("track_rate", 0), 2),
            "baro_rate": int(ac["baro_rate"]),
            "geom_rate": int(ac.get("geom_rate", ac["baro_rate"])),
            "squawk": ac["squawk"],
            "category": ac["category"],
            "nav_qnh": ac.get("nav_qnh", 1013.25),
            "nav_altitude_mcp": ac.get("nav_altitude_mcp"),
            "nav_heading": round(ac.get("nav_heading", ac["track"]), 1),
            "nic": ac.get("nic", 8),
            "rc": ac.get("rc", 186),
            "nac_p": ac.get("nac_p", 9),
            "nac_v": ac.get("nac_v", 2),
            "sil": ac.get("sil", 3),
            "sil_type": ac.get("sil_type", "perhour"),
            "gva": ac.get("gva", 2),
            "sda": ac.get("sda", 2),
            "alert": ac.get("alert", 0),
            "spi": ac.get("spi", 0),
            "rssi": round(ac["rssi"], 1),
            "dbFlags": ac["dbFlags"],
            "seen": round(ac["seen"], 1),
            "seen_pos": round(ac["seen_pos"], 1),
            "messages": ac.get("messages", 0),
        }
        
        # Add optional fields if present
        if ac.get("mach"):
            ac_out["mach"] = ac["mach"]
        if ac.get("ias"):
            ac_out["ias"] = ac["ias"]
        if ac.get("nav_modes"):
            ac_out["nav_modes"] = ac["nav_modes"]
        
        # Filter out None values
        ac_out = {k: v for k, v in ac_out.items() if v is not None}
        
        aircraft.append(ac_out)
    return aircraft


# ============================================================================
# Ultrafeeder endpoints
# ============================================================================

@app.route("/tar1090/data/aircraft.json")
def ultrafeeder_aircraft():
    """Main aircraft data endpoint"""
    with state_lock:
        update_all_aircraft(AIRCRAFT_TEMPLATES, aircraft_state)
        aircraft = get_aircraft_json(aircraft_state)
    
    return jsonify({
        "now": time.time(),
        "messages": message_count,
        "aircraft": aircraft
    })


@app.route("/tar1090/data/receiver.json")
def ultrafeeder_receiver():
    """Receiver info endpoint"""
    return jsonify({
        "version": "readsb-mock",
        "refresh": 1000,
        "history": 120,
        "lat": COVERAGE_CENTER_LAT,
        "lon": COVERAGE_CENTER_LON
    })


@app.route("/tar1090/data/stats.json")
def ultrafeeder_stats():
    """Statistics endpoint"""
    with state_lock:
        num_aircraft = len(aircraft_state)
    
    return jsonify({
        "latest": {
            "start": time.time() - 60,
            "end": time.time(),
            "tracks": {
                "all": num_aircraft + random.randint(50, 100),
                "single_message": random.randint(10, 30)
            },
            "messages": random.randint(400000, 600000),
            "cpu": {
                "demod": random.uniform(10, 20),
                "reader": random.uniform(3, 8),
                "background": random.uniform(1, 3)
            },
            "cpr": {
                "surface": random.randint(0, 10),
                "airborne": random.randint(1000, 2000),
                "global_ok": random.randint(900, 1800),
                "global_bad": random.randint(0, 50)
            }
        },
        "last1min": {
            "messages": random.randint(8000, 12000),
            "tracks": num_aircraft + random.randint(20, 50)
        }
    })


# ============================================================================
# dump978 endpoints
# ============================================================================

@app.route("/data/aircraft.json")
def dump978_aircraft():
    """UAT aircraft data endpoint"""
    with state_lock:
        update_all_aircraft(UAT_TEMPLATES, uat_aircraft_state)
        aircraft = get_aircraft_json(uat_aircraft_state)
    
    return jsonify({
        "now": time.time(),
        "messages": random.randint(5000, 15000),
        "aircraft": aircraft
    })


# ============================================================================
# Health check
# ============================================================================

@app.route("/health")
def health():
    uptime = time.time() - server_start_time
    with state_lock:
        num_aircraft = len(aircraft_state)
        num_uat = len(uat_aircraft_state)
    
    return jsonify({
        "status": "healthy",
        "type": MOCK_TYPE,
        "uptime_seconds": round(uptime, 1),
        "aircraft_count": num_aircraft,
        "uat_aircraft_count": num_uat,
        "messages_total": message_count,
    })


@app.route("/config")
def config():
    """Return current configuration"""
    return jsonify({
        "coverage": {
            "center_lat": COVERAGE_CENTER_LAT,
            "center_lon": COVERAGE_CENTER_LON,
            "radius_nm": COVERAGE_RADIUS_NM,
        },
        "wind": {
            "enabled": ENABLE_WEATHER,
            "direction_from": WIND_DIRECTION,
            "speed_kts": WIND_SPEED_KTS,
        },
        "traffic_density": TRAFFIC_DENSITY,
        "emergency_rate": EMERGENCY_RATE,
        "aircraft_templates": len(AIRCRAFT_TEMPLATES),
        "uat_templates": len(UAT_TEMPLATES),
    })


@app.route("/emergencies")
def emergencies():
    """Return aircraft with emergency squawks"""
    with state_lock:
        update_all_aircraft(AIRCRAFT_TEMPLATES, aircraft_state)
        all_ac = list(aircraft_state.values()) + list(uat_aircraft_state.values())
    
    emergency_ac = [ac for ac in all_ac if ac.get("squawk") in EMERGENCY_SQUAWKS]
    
    return jsonify({
        "count": len(emergency_ac),
        "aircraft": [
            {
                "hex": ac["hex"],
                "flight": ac["flight"].strip(),
                "squawk": ac["squawk"],
                "squawk_meaning": {
                    "7500": "HIJACK",
                    "7600": "RADIO FAILURE",
                    "7700": "EMERGENCY",
                }.get(ac["squawk"], "UNKNOWN"),
                "lat": round(ac["lat"], 4),
                "lon": round(ac["lon"], 4),
                "alt_baro": int(ac["alt_baro"]),
                "gs": round(ac["gs"], 1),
            }
            for ac in emergency_ac
        ]
    })


@app.route("/military")
def military():
    """Return military aircraft"""
    with state_lock:
        update_all_aircraft(AIRCRAFT_TEMPLATES, aircraft_state)
        all_ac = list(aircraft_state.values())
    
    mil_ac = [ac for ac in all_ac if ac.get("dbFlags", 0) & 1]
    
    return jsonify({
        "count": len(mil_ac),
        "aircraft": [
            {
                "hex": ac["hex"],
                "flight": ac["flight"].strip(),
                "type": ac["t"],
                "desc": ac.get("desc", ""),
                "lat": round(ac["lat"], 4),
                "lon": round(ac["lon"], 4),
                "alt_baro": int(ac["alt_baro"]),
                "gs": round(ac["gs"], 1),
                "track": round(ac["track"], 1),
            }
            for ac in mil_ac
        ]
    })


@app.route("/conflicts")
def conflicts():
    """
    Return current proximity conflicts.
    
    Conflict thresholds:
    - Horizontal: < 3nm
    - Vertical: < 1000ft
    - Both conditions must be true to trigger
    """
    global detected_conflicts, conflict_history
    
    with state_lock:
        update_all_aircraft(AIRCRAFT_TEMPLATES, aircraft_state)
        current_conflicts = detect_conflicts(aircraft_state)
    
    # Update conflict history (keep last 100)
    for conflict in current_conflicts:
        # Check if this conflict pair already exists in history
        existing = next(
            (c for c in conflict_history if c["id"] == conflict["id"]),
            None
        )
        if existing:
            existing.update(conflict)
            existing["last_seen"] = time.time()
            existing["occurrences"] = existing.get("occurrences", 1) + 1
        else:
            conflict["first_seen"] = time.time()
            conflict["last_seen"] = time.time()
            conflict["occurrences"] = 1
            conflict_history.append(conflict)
    
    # Trim old history (older than 5 minutes)
    cutoff = time.time() - 300
    conflict_history = [c for c in conflict_history if c.get("last_seen", 0) > cutoff]
    
    # Calculate statistics
    stats = {
        "active_conflicts": len(current_conflicts),
        "total_in_history": len(conflict_history),
        "by_severity": {
            "CRITICAL": len([c for c in current_conflicts if c["severity"] == "CRITICAL"]),
            "WARNING": len([c for c in current_conflicts if c["severity"] == "WARNING"]),
            "ALERT": len([c for c in current_conflicts if c["severity"] == "ALERT"]),
        },
        "converging_pairs": len([c for c in current_conflicts if c["dynamics"]["converging"]]),
    }
    
    return jsonify({
        "timestamp": time.time(),
        "thresholds": {
            "horizontal_nm": CONFLICT_HORIZONTAL_NM,
            "vertical_ft": CONFLICT_VERTICAL_FT,
        },
        "statistics": stats,
        "active_conflicts": current_conflicts,
        "recent_history": sorted(
            conflict_history[-20:],  # Last 20 conflicts
            key=lambda x: x.get("last_seen", 0),
            reverse=True
        ),
    })


@app.route("/conflicts/test")
def conflicts_test():
    """
    Returns info about conflict test aircraft pairs.
    """
    with state_lock:
        update_all_aircraft(AIRCRAFT_TEMPLATES, aircraft_state)
        
        # Find all conflict test aircraft
        conflict_aircraft = {
            hex_code: ac for hex_code, ac in aircraft_state.items()
            if ac.get("profile", "").startswith("conflict_") or hex_code.startswith("CF")
        }
    
    pairs = []
    seen_pairs = set()
    
    for template in AIRCRAFT_TEMPLATES:
        if template.get("conflict_pair"):
            pair_key = tuple(sorted([template["hex"], template["conflict_pair"]]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            
            ac1 = conflict_aircraft.get(template["hex"])
            ac2 = conflict_aircraft.get(template["conflict_pair"])
            
            if ac1 and ac2:
                horiz_sep = calculate_distance_nm(ac1["lat"], ac1["lon"], ac2["lat"], ac2["lon"])
                vert_sep = abs(ac1.get("alt_baro", 0) - ac2.get("alt_baro", 0))
                
                in_conflict = horiz_sep < CONFLICT_HORIZONTAL_NM and vert_sep < CONFLICT_VERTICAL_FT
                
                pairs.append({
                    "pair_id": f"{template['hex']}-{template['conflict_pair']}",
                    "conflict_type": template.get("conflict_type", "unknown"),
                    "in_conflict": in_conflict,
                    "aircraft1": {
                        "hex": ac1["hex"],
                        "flight": ac1["flight"].strip(),
                        "lat": round(ac1["lat"], 4),
                        "lon": round(ac1["lon"], 4),
                        "alt_baro": int(ac1["alt_baro"]),
                        "track": round(ac1["track"], 1),
                        "gs": round(ac1["gs"], 1),
                    },
                    "aircraft2": {
                        "hex": ac2["hex"],
                        "flight": ac2["flight"].strip(),
                        "lat": round(ac2["lat"], 4),
                        "lon": round(ac2["lon"], 4),
                        "alt_baro": int(ac2["alt_baro"]),
                        "track": round(ac2["track"], 1),
                        "gs": round(ac2["gs"], 1),
                    },
                    "separation": {
                        "horizontal_nm": round(horiz_sep, 2),
                        "vertical_ft": int(vert_sep),
                    },
                })
    
    active_conflicts = len([p for p in pairs if p["in_conflict"]])
    
    return jsonify({
        "description": "Conflict test aircraft pairs designed to trigger proximity alerts",
        "thresholds": {
            "horizontal_nm": CONFLICT_HORIZONTAL_NM,
            "vertical_ft": CONFLICT_VERTICAL_FT,
        },
        "summary": {
            "total_pairs": len(pairs),
            "pairs_in_conflict": active_conflicts,
        },
        "pairs": pairs,
    })


@app.route("/")
def index():
    return jsonify({
        "service": f"{MOCK_TYPE}-mock",
        "version": "2.1.0",
        "description": "Realistic ADS-B mock server for testing with conflict detection",
        "endpoints": {
            "aircraft_data": {
                "/tar1090/data/aircraft.json": "Main 1090MHz aircraft feed",
                "/tar1090/data/receiver.json": "Receiver information",
                "/tar1090/data/stats.json": "Receiver statistics",
                "/data/aircraft.json": "UAT 978MHz aircraft feed",
            },
            "utilities": {
                "/health": "Server health check",
                "/config": "Current configuration",
                "/emergencies": "Aircraft with emergency squawks",
                "/military": "Military aircraft",
            },
            "conflict_detection": {
                "/conflicts": "Active proximity conflicts (< 3nm horizontal AND < 1000ft vertical)",
                "/conflicts/test": "Status of conflict test aircraft pairs",
            }
        },
        "conflict_thresholds": {
            "horizontal_nm": CONFLICT_HORIZONTAL_NM,
            "vertical_ft": CONFLICT_VERTICAL_FT,
            "note": "Both conditions must be true to trigger a conflict",
        },
        "configuration": {
            "coverage_center": f"{COVERAGE_CENTER_LAT}, {COVERAGE_CENTER_LON}",
            "coverage_radius_nm": COVERAGE_RADIUS_NM,
            "traffic_density": TRAFFIC_DENSITY,
            "weather_enabled": ENABLE_WEATHER,
        }
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "80"))
    
    # Apply traffic density
    density_mult = DENSITY_MULTIPLIERS.get(TRAFFIC_DENSITY, 1.0)
    active_templates = AIRCRAFT_TEMPLATES[:int(len(AIRCRAFT_TEMPLATES) * density_mult)]
    
    # Count conflict test aircraft
    conflict_pairs = len([t for t in AIRCRAFT_TEMPLATES if t.get("conflict_pair")]) // 2
    
    print(f"=" * 60)
    print(f"ADS-B Mock Server v2.1.0 - Conflict Detection")
    print(f"=" * 60)
    print(f"Port:             {port}")
    print(f"Coverage center:  {COVERAGE_CENTER_LAT:.4f}, {COVERAGE_CENTER_LON:.4f}")
    print(f"Coverage radius:  {COVERAGE_RADIUS_NM} NM")
    print(f"Traffic density:  {TRAFFIC_DENSITY} ({len(active_templates)} aircraft)")
    print(f"Conflict pairs:   {conflict_pairs} pairs configured for testing")
    print(f"Conflict thresh:  < {CONFLICT_HORIZONTAL_NM}nm AND < {CONFLICT_VERTICAL_FT}ft")
    print(f"Weather/wind:     {'Enabled' if ENABLE_WEATHER else 'Disabled'}")
    if ENABLE_WEATHER:
        print(f"  Wind:           {WIND_SPEED_KTS} kts from {WIND_DIRECTION}°")
    print(f"Emergency rate:   {EMERGENCY_RATE * 100:.0f}%")
    print(f"=" * 60)
    print(f"Endpoints:")
    print(f"  /conflicts      - Active proximity conflicts")
    print(f"  /conflicts/test - Conflict test aircraft status")
    print(f"=" * 60)
    
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)