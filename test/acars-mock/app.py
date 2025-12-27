#!/usr/bin/env python3
"""
ACARSHUB Mock Service

This service mocks the sdr-enthusiasts/docker-acarshub container by:
1. Listening for ACARS/VDLM2/HFDL messages on UDP ports (like real ACARSHUB)
2. Generating realistic mock ACARS messages for testing
3. Relaying all messages to a downstream service
4. Providing a web interface and API for monitoring

UDP Ports (matching real ACARSHUB):
- 5550: ACARS (acarsdec)
- 5555: VDLM2 (dumpvdl2)
- 5556: HFDL (dumphfdl)
- 5557: IMSL (Inmarsat)
- 5558: IRDM (Iridium)

TCP Relay Ports:
- 15550: ACARS relay
- 15555: VDLM2 relay
- 15556: HFDL relay
- 15557: IMSL relay
- 15558: IRDM relay
"""

import asyncio
import json
import logging
import os
import random
import socket
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("acarshub-mock")


class Settings(BaseSettings):
    """Application settings from environment variables"""
    # Mock generation settings
    mock_enabled: bool = True
    mock_interval_min: float = 1.0  # Minimum seconds between mock messages
    mock_interval_max: float = 5.0  # Maximum seconds between mock messages
    
    # UDP listener ports
    acars_udp_port: int = 5550
    vdlm2_udp_port: int = 5555
    hfdl_udp_port: int = 5556
    imsl_udp_port: int = 5557
    irdm_udp_port: int = 5558
    
    # TCP relay ports
    acars_tcp_port: int = 15550
    vdlm2_tcp_port: int = 15555
    hfdl_tcp_port: int = 15556
    imsl_tcp_port: int = 15557
    irdm_tcp_port: int = 15558
    
    # Relay destination (your service)
    relay_host: str = "api"
    relay_port: int = 0
    relay_protocol: str = "udp"  # udp or tcp
    
    # Web interface
    web_port: int = 8080
    
    # Station ID
    station_id: str = "MOCK-STATION"

    # API URL for fetching real callsigns
    api_url: str = "http://api:5000"

    class Config:
        env_prefix = ""


settings = Settings()


# Sample data for realistic mock messages
AIRLINES = [
    ("AAL", "American Airlines", "N"),
    ("UAL", "United Airlines", "N"),
    ("DAL", "Delta Air Lines", "N"),
    ("SWA", "Southwest Airlines", "N"),
    ("ASA", "Alaska Airlines", "N"),
    ("JBU", "JetBlue Airways", "N"),
    ("FFT", "Frontier Airlines", "N"),
    ("NKS", "Spirit Airlines", "N"),
    ("BAW", "British Airways", "G"),
    ("DLH", "Lufthansa", "D"),
    ("AFR", "Air France", "F"),
    ("KLM", "KLM", "PH"),
    ("JAL", "Japan Airlines", "JA"),
    ("ANA", "All Nippon Airways", "JA"),
    ("QFA", "Qantas", "VH"),
    ("UAE", "Emirates", "A6"),
    ("SIA", "Singapore Airlines", "9V"),
    ("CPA", "Cathay Pacific", "B"),
    ("ACA", "Air Canada", "C"),
    ("WJA", "WestJet", "C"),
]

AIRPORTS = [
    "KSEA", "KPAE", "KBFI", "KORD", "KJFK", "KLAX", "KSFO", "KDEN",
    "KATL", "KDFW", "KMIA", "KBOS", "KPHX", "KLAS", "KMSP", "KDTW",
    "EGLL", "LFPG", "EDDF", "EHAM", "RJTT", "VHHH", "WSSS", "YSSY",
    "CYYZ", "CYVR", "OMDB", "ZBAA", "RKSI", "VTBS"
]

ACARS_LABELS = [
    ("_d", "Demand mode"),
    ("Q0", "Link test"),
    ("SA", "General text"),
    ("SQ", "Squawk"),
    ("H1", "Message to/from crew"),
    ("H2", "Message to/from crew"),
    ("B9", "Departure/arrival"),
    ("10", "Departure clearance"),
    ("12", "Departure ATIS"),
    ("14", "OOOI event"),
    ("15", "Weather request"),
    ("16", "Weather"),
    ("20", "Position report"),
    ("21", "Position request"),
    ("22", "ADS-C report"),
    ("30", "Oceanic clearance"),
    ("44", "METAR"),
    ("80", "Engine data"),
    ("81", "Engine data"),
    ("83", "ACMS data"),
]

# Realistic ACARS message templates by label type
REALISTIC_TEMPLATES = {
    # Position reports (labels 20, 22) - ADS-C style
    "20": [
        "/POS{lat_dir}{lat:07.4f}/{lon_dir}{lon:08.4f},ALT{alt},SPD{gs},HDG{track:03.0f},FOB{fob}",
        "POS N{lat:.4f}{lat_dir} {lon:.4f}{lon_dir} {time}Z FL{fl} M.{mach} {wind_dir:03d}/{wind_spd:02d}",
        "/POSRPT/{lat:.2f}{lat_dir}/{lon:.2f}{lon_dir}/{time}/{fl}/M{mach:.2f}/{gs}KT",
        "LAT {lat_dir}{lat:.4f}/LON {lon_dir}{lon:.4f}/ALT {alt}/TAS {tas}/SAT {sat}",
    ],
    "22": [
        "ADS-C RPT/{lat:.3f}{lat_dir}/{lon:.3f}{lon_dir},FL{fl},{time}Z,{gs}KT,{track:03.0f}T",
        "/ADS N{lat:.4f} W{lon:.4f} {alt}FT {gs}KT TRK{track:03.0f}",
    ],
    # OOOI events (label 14) - Out/Off/On/In
    "14": [
        "OUT/{dep}/{time}",
        "OFF/{dep}/{time}",
        "ON/{arr}/{time}",
        "IN/{arr}/{time}",
        "{event} {airport} {time} {date}",
    ],
    # Weather/ATIS (labels 15, 16, 44)
    "15": [
        "REQ WX {airport}",
        "RQ MET {airport}",
        "WXRQ/{airport}/{time}",
    ],
    "16": [
        "{airport} {time}Z {wind_dir:03d}{wind_spd:02d}KT {vis}SM {clouds} {temp}/{dewpt} A{altimeter}",
        "TAF {airport} {time}Z {wind_dir:03d}{wind_spd:02d}G{gust:02d}KT P6SM SCT{sct:03d} BKN{bkn:03d}",
    ],
    "44": [
        "METAR {airport} {day:02d}{time}Z {wind_dir:03d}{wind_spd:02d}KT {vis}SM {clouds} {temp:02d}/{dewpt:02d} A{altimeter}",
        "SPECI {airport} {day:02d}{time}Z {wind_dir:03d}{wind_spd:02d}G{gust:02d}KT {vis}SM {clouds} {temp:02d}/{dewpt:02d} A{altimeter} RMK AO2",
    ],
    # Engine/performance data (labels 80, 81, 83)
    "80": [
        "ENG 1: N1={n1_1:.1f} N2={n2_1:.1f} EGT={egt_1} FF={ff_1}\nENG 2: N1={n1_2:.1f} N2={n2_2:.1f} EGT={egt_2} FF={ff_2}",
        "#CFBENG/{time}/N1 {n1_1:.1f}/{n1_2:.1f}/N2 {n2_1:.1f}/{n2_2:.1f}/FF {ff_1}/{ff_2}",
    ],
    "81": [
        "CRUISE RPT FL{fl} SAT{sat:+d} TAT{tat:+d} N1={n1_1:.1f}/{n1_2:.1f} FF={ff_tot}",
        "PERF/{time}/FL{fl}/GW{gw}/CG{cg:.1f}/FUEL{fuel}",
    ],
    "83": [
        "ACMS RPT {time}Z\nFLT PHASE: {phase}\nALT: {alt} SPD: {spd}\nFUEL: {fuel} LBS FOB",
        "DFDR/{time}/ALT{alt}/CAS{cas}/MACH{mach:.3f}/SAT{sat:+d}/TAT{tat:+d}",
    ],
    # General/crew messages (labels SA, H1, H2)
    "SA": [
        "ETA {arr} {eta}Z FUEL {fuel}",
        "DELAY DUE TO {reason}. NEW ETD {etd}Z",
        "PAX COUNT: {pax} CREW: {crew}",
        "GATE ARRIVAL REQUEST {arr}",
        "CONNECTING PAX: {conn_pax} TO {conn_flt}",
        "CATERING CHANGE: {item}",
        "MX STATUS: {system} NORMAL",
    ],
    "H1": [
        "TO CREW: {msg}",
        "OPS MSG: {msg}",
        "DISP INFO: {msg}",
        "WX ADVISORY: {advisory}",
    ],
    "H2": [
        "FROM CREW: {msg}",
        "PILOT RPT: {msg}",
        "CABIN RPT: {msg}",
    ],
    # Departure/clearance (labels 10, 12, 30, B9)
    "10": [
        "CLR TO {arr} VIA {sid} {route} SQUAWK {squawk}",
        "PDC {flight}/{arr}/{sid}/RWY{rwy}/INIT ALT {alt}/DEP FREQ {freq}/SQUAWK {squawk}",
    ],
    "12": [
        "ATIS {letter}: {airport} {time}Z. RWY {rwy} IN USE. WIND {wind_dir:03d}/{wind_spd:02d}. VIS {vis}. {clouds}. TEMP {temp}. DEW {dewpt}. ALT {altimeter}. ADVS YOU HAVE INFO {letter}.",
    ],
    "30": [
        "OCEANIC CLR: {route} MACH {mach:.2f} FL{fl} {entry}",
        "SELCAL {selcal}. {route}. FL{fl}. MACH {mach:.2f}",
    ],
    "B9": [
        "ARR {arr} GATE {gate} {time}Z",
        "DEP {dep} GATE {gate} {time}Z",
        "ALTN {altn} WX {reason}",
    ],
    # Link test/demand (labels _d, Q0, SQ)
    "_d": [""],
    "Q0": [""],
    "SQ": ["{squawk}"],
    "21": ["REQ POS {waypoint}"],
}

# Delay reasons for realistic messages
DELAY_REASONS = [
    "ATC FLOW CONTROL", "WEATHER", "MAINTENANCE", "CREW AVAILABILITY",
    "LATE ARRIVING AIRCRAFT", "GATE HOLD", "FUELING", "CATERING",
    "SECURITY", "PASSENGER BOARDING", "CONNECTING PASSENGERS", "CARGO LOADING"
]

# Flight phases for ACMS reports
FLIGHT_PHASES = ["TAXI OUT", "TAKEOFF", "CLIMB", "CRUISE", "DESCENT", "APPROACH", "LANDING", "TAXI IN"]

# Systems for maintenance messages
AIRCRAFT_SYSTEMS = [
    "HYDRAULICS", "ELECTRICAL", "PRESSURIZATION", "APU", "ENG 1", "ENG 2",
    "FUEL", "ANTI-ICE", "AUTOPILOT", "FMS", "TCAS", "WEATHER RADAR"
]

# SIDs and airways for routing
SIDS = ["HAROB2", "SUMMA1", "OZWLD4", "JEFPO1", "PAINE1", "BANGR9", "ELMAA4", "HAWKZ8"]
AIRWAYS = ["J1", "J4", "J70", "Q1", "Q144", "V23", "V187", "T280", "UL851"]
WAYPOINTS = ["MARNR", "JAWBN", "ZADON", "GLASR", "HETHR", "NORMY", "COUGA", "TUMBL"]

# Crew messages
CREW_MESSAGES = [
    "ROGER", "WILCO", "CONFIRM GATE INFO", "REQUEST FUEL UPDATE",
    "MEDICAL EMERGENCY ON BOARD", "TURBULENCE REPORT FL{fl}",
    "RIDE REPORT: {ride} AT FL{fl}", "PIREP: {pirep}"
]

# Weather advisories
WX_ADVISORIES = [
    "SIGMET {id}: TS AREA {loc}", "CONVECTIVE ACTIVITY {dir} OF ROUTE",
    "MOD TURB FL{fl_lo}-{fl_hi}", "ICING REPORTED FL{fl_lo}-{fl_hi}",
    "VOLCANIC ASH ADVISORY {area}"
]

# Ride conditions
RIDE_CONDITIONS = ["SMOOTH", "LIGHT CHOP", "LIGHT TURB", "MOD CHOP", "MOD TURB", "SEV TURB"]

# Pilot reports
PIREPS = [
    "MOD ICE FL{fl}", "NEG ICE FL{fl}", "WIND {dir}/{spd} FL{fl}",
    "TOPS FL{fl}", "BASES FL{fl}"
]


@dataclass
class ACARSMessage:
    """Represents an ACARS message in the format expected by ACARSHUB"""
    timestamp: float = field(default_factory=time.time)
    station_id: str = ""
    channel: int = 0
    frequency: float = 131.550
    level: int = -30
    error: int = 0
    mode: str = "2"
    label: str = "_d"
    block_id: str = ""
    ack: str = "!"
    tail: str = ""
    flight: str = ""
    msgno: str = ""
    text: str = ""
    end: bool = True
    msg_type: str = "acars"  # acars, vdlm2, hfdl, imsl, irdm
    
    def to_acarsdec_json(self) -> dict:
        """Convert to acarsdec JSON format"""
        return {
            "timestamp": self.timestamp,
            "station_id": self.station_id,
            "channel": self.channel,
            "freq": self.frequency,
            "level": self.level,
            "error": self.error,
            "mode": self.mode,
            "label": self.label,
            "block_id": self.block_id,
            "ack": self.ack,
            "tail": self.tail,
            "flight": self.flight,
            "msgno": self.msgno,
            "text": self.text,
            "end": self.end,
        }
    
    def to_dumpvdl2_json(self) -> dict:
        """Convert to dumpvdl2 JSON format"""
        return {
            "vdl2": {
                "app": {
                    "name": "dumpvdl2",
                    "ver": "2.5.0"
                },
                "t": {
                    "sec": int(self.timestamp),
                    "usec": int((self.timestamp % 1) * 1000000)
                },
                "freq": int(self.frequency * 1000000),
                "sig_level": self.level,
                "noise_level": self.level - 20,
                "station": self.station_id,
                "avlc": {
                    "src": {
                        "addr": self.tail.replace("-", ""),
                        "type": "Aircraft",
                        "status": "Airborne"
                    },
                    "dst": {
                        "addr": "GROUND",
                        "type": "Ground station"
                    },
                    "cr": "Command",
                    "acars": {
                        "err": self.error == 0,
                        "crc_ok": True,
                        "more": not self.end,
                        "mode": self.mode,
                        "reg": f".{self.tail}",
                        "label": self.label,
                        "blk_id": self.block_id,
                        "ack": self.ack,
                        "flight": self.flight,
                        "msg_num": self.msgno,
                        "msg_num_seq": "A",
                        "msg_text": self.text
                    }
                }
            }
        }


class MessageStore:
    """Store for received and generated messages"""
    def __init__(self, max_messages: int = 1000):
        self.messages: list[dict] = []
        self.max_messages = max_messages
        self.total_received = 0
        self.total_generated = 0
        self.websocket_clients: set[WebSocket] = set()
    
    async def add_message(self, msg: dict, source: str = "received"):
        """Add a message to the store and broadcast to clients"""
        msg["_source"] = source
        msg["_received_at"] = datetime.now(timezone.utc).isoformat()
        
        self.messages.append(msg)
        if len(self.messages) > self.max_messages:
            self.messages.pop(0)
        
        if source == "received":
            self.total_received += 1
        else:
            self.total_generated += 1
        
        # Broadcast to WebSocket clients
        for ws in list(self.websocket_clients):
            try:
                await ws.send_json(msg)
            except Exception:
                self.websocket_clients.discard(ws)
    
    def get_stats(self) -> dict:
        return {
            "total_received": self.total_received,
            "total_generated": self.total_generated,
            "messages_in_buffer": len(self.messages),
            "websocket_clients": len(self.websocket_clients),
        }


message_store = MessageStore()


class MockGenerator:
    """Generates realistic mock ACARS messages"""

    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._callsigns: list[dict] = []  # Cache of aircraft from API
        self._callsign_refresh_task: Optional[asyncio.Task] = None

    async def _refresh_callsigns(self):
        """Periodically fetch callsigns from the API"""
        async with httpx.AsyncClient() as client:
            while self.running:
                try:
                    response = await client.get(
                        f"{settings.api_url}/api/v1/aircraft",
                        timeout=5.0
                    )
                    if response.status_code == 200:
                        data = response.json()
                        aircraft = data.get("aircraft", [])
                        # Filter to aircraft with callsigns
                        self._callsigns = [
                            {
                                "flight": ac.get("flight", "").strip(),
                                "hex": ac.get("hex", ""),
                                "lat": ac.get("lat"),
                                "lon": ac.get("lon"),
                                "alt_baro": ac.get("alt_baro"),
                                "gs": ac.get("gs"),
                                "track": ac.get("track"),
                            }
                            for ac in aircraft
                            if ac.get("flight") and ac.get("flight").strip()
                        ]
                        logger.info(f"Refreshed callsigns: {len(self._callsigns)} aircraft with callsigns")
                except Exception as e:
                    logger.warning(f"Failed to fetch callsigns from API: {e}")

                await asyncio.sleep(10)  # Refresh every 10 seconds

    def generate_registration(self, prefix: str) -> str:
        """Generate a realistic aircraft registration"""
        if prefix == "N":
            # US registration
            return f"N{random.randint(1, 999)}{random.choice(['', 'A', 'B', 'C', 'D', 'E'])}{random.choice(['', 'A', 'B', 'C', 'D', 'E'])}"
        elif prefix == "G":
            return f"G-{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
        elif prefix == "D":
            return f"D-A{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
        else:
            return f"{prefix}-{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}{random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"

    def _hex_to_tail(self, hex_code: str) -> str:
        """Convert ICAO hex to a plausible tail number"""
        if not hex_code:
            return self.generate_registration("N")
        # US aircraft hex codes start with A
        if hex_code.upper().startswith("A"):
            return f"N{hex_code[1:].upper()}"
        # Otherwise generate based on first char
        return f".{hex_code.upper()}"

    def _generate_text_from_aircraft(self, label: str, now: datetime, ac: dict) -> str:
        """Generate realistic message text using real aircraft data"""
        lat = ac.get("lat") or random.uniform(30, 50)
        lon = ac.get("lon") or random.uniform(-125, -70)
        alt = ac.get("alt_baro")
        gs = ac.get("gs") or random.randint(400, 520)
        track = ac.get("track") or random.randint(0, 359)
        flight = ac.get("flight", "")

        # Common derived values
        lat_dir = "N" if lat >= 0 else "S"
        lon_dir = "W" if lon < 0 else "E"
        fl = int(alt) // 100 if isinstance(alt, (int, float)) and alt > 0 else random.randint(300, 420)
        alt_ft = int(alt) if isinstance(alt, (int, float)) else fl * 100
        time_str = now.strftime("%H%M")
        mach = random.uniform(0.78, 0.85)
        fob = random.randint(8000, 45000)  # Fuel on board

        # Build context for template formatting
        ctx = {
            "lat": abs(lat),
            "lon": abs(lon),
            "lat_dir": lat_dir,
            "lon_dir": lon_dir,
            "alt": alt_ft,
            "fl": fl,
            "gs": gs,
            "track": track,
            "time": time_str,
            "mach": mach,
            "fob": fob,
            "tas": gs + random.randint(-20, 40),
            "sat": random.randint(-60, -40),
            "tat": random.randint(-30, -10),
            "wind_dir": random.randint(0, 359),
            "wind_spd": random.randint(10, 80),
            "gust": random.randint(15, 35),
            "fuel": random.randint(15000, 50000),
            "dep": random.choice(AIRPORTS),
            "arr": random.choice(AIRPORTS),
            "airport": random.choice(AIRPORTS),
            "altn": random.choice(AIRPORTS),
            "flight": flight,
        }

        # Get templates for this label
        templates = REALISTIC_TEMPLATES.get(label, [])
        if not templates:
            return ""

        template = random.choice(templates)

        # Handle special cases by label
        try:
            if label in ("20", "22"):  # Position reports
                return template.format(**ctx)

            elif label == "14":  # OOOI
                event = random.choice(["OUT", "OFF", "ON", "IN"])
                airport = ctx["dep"] if event in ("OUT", "OFF") else ctx["arr"]
                ctx["event"] = event
                ctx["airport"] = airport
                ctx["date"] = now.strftime("%d%b").upper()
                return template.format(**ctx)

            elif label in ("15", "16", "44"):  # Weather
                ctx["vis"] = random.choice(["10", "P6", "6", "3", "1/2"])
                ctx["clouds"] = random.choice(["SKC", "FEW040", "SCT080", "BKN025", "OVC015", "FEW250"])
                ctx["temp"] = random.randint(-10, 35)
                ctx["dewpt"] = ctx["temp"] - random.randint(2, 15)
                ctx["altimeter"] = random.randint(2950, 3050)
                ctx["day"] = now.day
                ctx["sct"] = random.randint(30, 80)
                ctx["bkn"] = random.randint(80, 150)
                return template.format(**ctx)

            elif label in ("80", "81", "83"):  # Engine/performance
                ctx["n1_1"] = random.uniform(88, 94)
                ctx["n1_2"] = ctx["n1_1"] + random.uniform(-0.5, 0.5)
                ctx["n2_1"] = random.uniform(95, 99)
                ctx["n2_2"] = ctx["n2_1"] + random.uniform(-0.3, 0.3)
                ctx["egt_1"] = random.randint(750, 850)
                ctx["egt_2"] = ctx["egt_1"] + random.randint(-10, 10)
                ctx["ff_1"] = random.randint(2800, 3500)
                ctx["ff_2"] = ctx["ff_1"] + random.randint(-100, 100)
                ctx["ff_tot"] = ctx["ff_1"] + ctx["ff_2"]
                ctx["gw"] = random.randint(140000, 220000)
                ctx["cg"] = random.uniform(22, 28)
                ctx["phase"] = random.choice(FLIGHT_PHASES)
                ctx["spd"] = gs
                ctx["cas"] = gs - random.randint(50, 100)
                return template.format(**ctx)

            elif label == "SA":  # General
                ctx["eta"] = f"{(now.hour + random.randint(1, 5)) % 24:02d}{random.randint(0, 59):02d}"
                ctx["etd"] = f"{(now.hour + random.randint(0, 2)) % 24:02d}{random.randint(0, 59):02d}"
                ctx["reason"] = random.choice(DELAY_REASONS)
                ctx["pax"] = random.randint(80, 220)
                ctx["crew"] = random.randint(4, 12)
                ctx["conn_pax"] = random.randint(5, 30)
                ctx["conn_flt"] = f"{random.choice(['UAL', 'DAL', 'AAL', 'SWA'])}{random.randint(100, 2000)}"
                ctx["item"] = random.choice(["MEAL COUNT", "SPECIAL MEALS", "BEVERAGE SERVICE"])
                ctx["system"] = random.choice(AIRCRAFT_SYSTEMS)
                return template.format(**ctx)

            elif label in ("H1", "H2"):  # Crew messages
                msg_template = random.choice(CREW_MESSAGES)
                ctx["msg"] = msg_template.format(
                    fl=fl,
                    ride=random.choice(RIDE_CONDITIONS),
                    pirep=random.choice(PIREPS).format(fl=fl, dir=random.randint(0, 359), spd=random.randint(20, 100))
                )
                advisory_template = random.choice(WX_ADVISORIES)
                ctx["advisory"] = advisory_template.format(
                    id=f"{random.choice('ABCDEFGH')}{random.randint(1, 9)}",
                    loc=random.choice(["PACIFIC NW", "MIDWEST", "GULF", "ATLANTIC"]),
                    dir=random.choice(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
                    fl_lo=random.randint(200, 300),
                    fl_hi=random.randint(350, 450),
                    area=random.choice(["NORTH PACIFIC", "ALASKA", "HAWAII"])
                )
                return template.format(**ctx)

            elif label == "10":  # Departure clearance
                ctx["sid"] = random.choice(SIDS)
                route_parts = random.sample(WAYPOINTS, 3) + random.sample(AIRWAYS, 2)
                random.shuffle(route_parts)
                ctx["route"] = " ".join(route_parts[:4])
                ctx["squawk"] = f"{random.randint(0, 7)}{random.randint(0, 7)}{random.randint(0, 7)}{random.randint(0, 7)}"
                ctx["rwy"] = random.choice(["16L", "16R", "34L", "34R", "28L", "28R", "10L", "10R"])
                ctx["freq"] = f"1{random.randint(18, 36)}.{random.randint(0, 99):02d}"
                return template.format(**ctx)

            elif label == "12":  # ATIS
                ctx["letter"] = random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
                ctx["rwy"] = random.choice(["16L/16R", "34L/34R", "28L", "10R"])
                ctx["vis"] = random.choice(["10", "P6", "6"])
                ctx["clouds"] = random.choice(["FEW040", "SCT080", "BKN025"])
                ctx["temp"] = random.randint(40, 85)
                ctx["dewpt"] = ctx["temp"] - random.randint(5, 20)
                ctx["altimeter"] = random.randint(2980, 3030)
                return template.format(**ctx)

            elif label == "30":  # Oceanic clearance
                ctx["entry"] = random.choice(WAYPOINTS)
                route_pts = random.sample(WAYPOINTS, 4)
                ctx["route"] = "/".join(route_pts)
                ctx["selcal"] = f"{random.choice('ABCDEFGHJKLMPQRS')}{random.choice('ABCDEFGHJKLMPQRS')}-{random.choice('ABCDEFGHJKLMPQRS')}{random.choice('ABCDEFGHJKLMPQRS')}"
                return template.format(**ctx)

            elif label == "B9":  # Arrival/departure info
                ctx["gate"] = f"{random.choice('ABCDEFGN')}{random.randint(1, 45)}"
                ctx["reason"] = random.choice(["LOW VIS", "CONVECTIVE", "WINDS"])
                return template.format(**ctx)

            elif label == "SQ":
                ctx["squawk"] = f"{random.randint(0, 7)}{random.randint(0, 7)}{random.randint(0, 7)}{random.randint(0, 7)}"
                return template.format(**ctx)

            elif label == "21":
                ctx["waypoint"] = random.choice(WAYPOINTS)
                return template.format(**ctx)

            else:
                return template.format(**ctx) if template else ""

        except (KeyError, ValueError) as e:
            logger.debug(f"Template format error for label {label}: {e}")
            return f"MSG {time_str}"
    
    def generate_message(self) -> ACARSMessage:
        """Generate a random mock ACARS message using real callsigns when available"""
        label, label_desc = random.choice(ACARS_LABELS)
        now = datetime.now(timezone.utc)

        # Use real callsign from API if available
        if self._callsigns:
            ac = random.choice(self._callsigns)
            flight = ac["flight"]
            # Derive registration from hex or generate one
            tail = self._hex_to_tail(ac["hex"])
            # Use real position data for more realistic messages
            text = self._generate_text_from_aircraft(label, now, ac)
        else:
            # Fallback to random generation
            airline = random.choice(AIRLINES)
            airline_code, airline_name, reg_prefix = airline
            flight = f"{airline_code}{random.randint(1, 9999)}"
            tail = self.generate_registration(reg_prefix)
            text = self._generate_text(label, now)
        
        # Select message type and frequency
        msg_type = random.choices(
            ["acars", "vdlm2"],
            weights=[0.6, 0.4]
        )[0]
        
        if msg_type == "acars":
            frequency = random.choice([131.550, 131.525, 131.725, 131.825, 130.025, 130.425])
        else:
            frequency = random.choice([136.650, 136.700, 136.725, 136.775, 136.800, 136.825, 136.875, 136.900, 136.925, 136.975])
        
        return ACARSMessage(
            timestamp=time.time(),
            station_id=settings.station_id,
            channel=random.randint(0, 7),
            frequency=frequency,
            level=random.randint(-45, -15),
            error=0,
            mode=random.choice(["2", "X", "S"]),
            label=label,
            block_id=random.choice(["1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F"]),
            ack=random.choice(["!", "N", "A", "R"]),
            tail=tail,
            flight=flight,
            msgno=f"{random.choice('SMLCD')}{random.randint(0, 99):02d}{random.choice('ABCDEF')}",
            text=text,
            end=True,
            msg_type=msg_type,
        )
    
    def _generate_text(self, label: str, now: datetime) -> str:
        """Generate realistic message text based on label (fallback when no aircraft data)"""
        # Create a mock aircraft context with random data
        mock_ac = {
            "lat": random.uniform(30, 50),
            "lon": random.uniform(-125, -70),
            "alt_baro": random.randint(30000, 42000),
            "gs": random.randint(420, 520),
            "track": random.randint(0, 359),
            "flight": "",
        }
        return self._generate_text_from_aircraft(label, now, mock_ac)
    
    async def start(self):
        """Start generating mock messages"""
        self.running = True
        self._task = asyncio.create_task(self._generate_loop())
        self._callsign_refresh_task = asyncio.create_task(self._refresh_callsigns())
        logger.info("Mock message generator started")
    
    async def stop(self):
        """Stop generating mock messages"""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._callsign_refresh_task:
            self._callsign_refresh_task.cancel()
            try:
                await self._callsign_refresh_task
            except asyncio.CancelledError:
                pass
        logger.info("Mock message generator stopped")
    
    async def _generate_loop(self):
        """Main loop for generating mock messages"""
        while self.running:
            try:
                interval = random.uniform(
                    settings.mock_interval_min,
                    settings.mock_interval_max
                )
                await asyncio.sleep(interval)
                
                msg = self.generate_message()
                
                # Convert to appropriate JSON format
                if msg.msg_type == "acars":
                    json_msg = msg.to_acarsdec_json()
                else:
                    json_msg = msg.to_dumpvdl2_json()
                
                # Add to message store
                await message_store.add_message(json_msg, source="generated")
                
                # Relay to downstream service
                await relay_message(json_msg, msg.msg_type)
                
                logger.debug(f"Generated {msg.msg_type} message: {msg.flight} {msg.label}")
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in mock generator: {e}")


mock_generator = MockGenerator()


class UDPProtocol(asyncio.DatagramProtocol):
    """UDP protocol handler for receiving ACARS messages"""
    
    def __init__(self, msg_type: str):
        self.msg_type = msg_type
        self.transport = None
    
    def connection_made(self, transport):
        self.transport = transport
    
    def datagram_received(self, data: bytes, addr: tuple):
        try:
            # Try to decode as JSON
            msg_str = data.decode('utf-8').strip()
            if msg_str:
                msg = json.loads(msg_str)
                asyncio.create_task(self._handle_message(msg, addr))
        except json.JSONDecodeError as e:
            logger.warning(f"Invalid JSON from {addr}: {e}")
        except Exception as e:
            logger.error(f"Error processing UDP message: {e}")
    
    async def _handle_message(self, msg: dict, addr: tuple):
        """Handle received message"""
        logger.info(f"Received {self.msg_type} message from {addr}")
        await message_store.add_message(msg, source="received")
        await relay_message(msg, self.msg_type)


class TCPRelayProtocol(asyncio.Protocol):
    """TCP protocol for relaying messages to connected clients"""
    
    clients: dict[str, set] = {
        "acars": set(),
        "vdlm2": set(),
        "hfdl": set(),
        "imsl": set(),
        "irdm": set(),
    }
    
    def __init__(self, msg_type: str):
        self.msg_type = msg_type
        self.transport = None
    
    def connection_made(self, transport):
        self.transport = transport
        TCPRelayProtocol.clients[self.msg_type].add(self)
        peer = transport.get_extra_info('peername')
        logger.info(f"TCP client connected for {self.msg_type}: {peer}")
    
    def connection_lost(self, exc):
        TCPRelayProtocol.clients[self.msg_type].discard(self)
        logger.info(f"TCP client disconnected from {self.msg_type}")
    
    @classmethod
    async def broadcast(cls, msg_type: str, data: bytes):
        """Broadcast message to all connected clients of a type"""
        for client in list(cls.clients.get(msg_type, [])):
            try:
                client.transport.write(data + b'\n')
            except Exception as e:
                logger.error(f"Error broadcasting to TCP client: {e}")


# Global relay socket
relay_socket: Optional[socket.socket] = None


async def relay_message(msg: dict, msg_type: str):
    """Relay message to configured destination and TCP clients"""
    global relay_socket
    
    msg_bytes = (json.dumps(msg) + '\n').encode('utf-8')
    
    # Relay via TCP to connected clients
    await TCPRelayProtocol.broadcast(msg_type, msg_bytes.strip())
    
    # Relay to configured destination
    if settings.relay_host and settings.relay_port:
        try:
            if settings.relay_protocol == "udp":
                if relay_socket is None:
                    relay_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                relay_socket.sendto(msg_bytes, (settings.relay_host, settings.relay_port))
            else:
                # TCP relay (would need connection management)
                pass
        except Exception as e:
            logger.error(f"Error relaying message: {e}")


# FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    loop = asyncio.get_event_loop()
    
    # Start UDP listeners
    udp_ports = [
        (settings.acars_udp_port, "acars"),
        (settings.vdlm2_udp_port, "vdlm2"),
        (settings.hfdl_udp_port, "hfdl"),
        (settings.imsl_udp_port, "imsl"),
        (settings.irdm_udp_port, "irdm"),
    ]
    
    udp_transports = []
    for port, msg_type in udp_ports:
        try:
            transport, protocol = await loop.create_datagram_endpoint(
                lambda mt=msg_type: UDPProtocol(mt),
                local_addr=('0.0.0.0', port)
            )
            udp_transports.append(transport)
            logger.info(f"UDP listener started on port {port} for {msg_type}")
        except Exception as e:
            logger.error(f"Failed to start UDP listener on port {port}: {e}")
    
    # Start TCP relay servers
    tcp_ports = [
        (settings.acars_tcp_port, "acars"),
        (settings.vdlm2_tcp_port, "vdlm2"),
        (settings.hfdl_tcp_port, "hfdl"),
        (settings.imsl_tcp_port, "imsl"),
        (settings.irdm_tcp_port, "irdm"),
    ]
    
    tcp_servers = []
    for port, msg_type in tcp_ports:
        try:
            server = await loop.create_server(
                lambda mt=msg_type: TCPRelayProtocol(mt),
                '0.0.0.0', port
            )
            tcp_servers.append(server)
            logger.info(f"TCP relay server started on port {port} for {msg_type}")
        except Exception as e:
            logger.error(f"Failed to start TCP server on port {port}: {e}")
    
    # Start mock generator if enabled
    if settings.mock_enabled:
        await mock_generator.start()
    
    yield
    
    # Cleanup
    await mock_generator.stop()
    
    for transport in udp_transports:
        transport.close()
    
    for server in tcp_servers:
        server.close()
        await server.wait_closed()


app = FastAPI(
    title="ACARSHUB Mock Service",
    description="Mock service for testing ACARSHUB integrations",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the web interface"""
    return """
<!DOCTYPE html>
<html>
<head>
    <title>ACARSHUB Mock Service</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #00d4ff; }
        .stats { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .messages { background: #0f3460; padding: 15px; border-radius: 8px; height: 500px; overflow-y: auto; }
        .message { background: #1a1a2e; padding: 10px; margin: 5px 0; border-radius: 4px; font-family: monospace; font-size: 12px; }
        .message.acars { border-left: 3px solid #00ff88; }
        .message.vdlm2 { border-left: 3px solid #ff8800; }
        .message.generated { opacity: 0.8; }
        .controls { margin-bottom: 20px; }
        button { background: #00d4ff; color: #1a1a2e; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-right: 10px; }
        button:hover { background: #00a8cc; }
        .status { display: inline-block; padding: 5px 10px; border-radius: 4px; }
        .status.connected { background: #00ff88; color: #1a1a2e; }
        .status.disconnected { background: #ff4444; color: white; }
    </style>
</head>
<body>
    <h1>🛩️ ACARSHUB Mock Service</h1>
    
    <div class="controls">
        <button onclick="toggleMock()">Toggle Mock Generation</button>
        <button onclick="clearMessages()">Clear Messages</button>
        <span id="wsStatus" class="status disconnected">Disconnected</span>
    </div>
    
    <div class="stats" id="stats">Loading stats...</div>
    
    <h2>Live Messages</h2>
    <div class="messages" id="messages"></div>
    
    <script>
        let ws;
        let mockEnabled = true;
        
        function connect() {
            ws = new WebSocket(`ws://${location.host}/ws`);
            
            ws.onopen = () => {
                document.getElementById('wsStatus').className = 'status connected';
                document.getElementById('wsStatus').textContent = 'Connected';
            };
            
            ws.onclose = () => {
                document.getElementById('wsStatus').className = 'status disconnected';
                document.getElementById('wsStatus').textContent = 'Disconnected';
                setTimeout(connect, 2000);
            };
            
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                addMessage(msg);
            };
        }
        
        function addMessage(msg) {
            const container = document.getElementById('messages');
            const div = document.createElement('div');
            
            let msgType = 'acars';
            if (msg.vdl2) msgType = 'vdlm2';
            
            div.className = `message ${msgType} ${msg._source}`;
            
            let text = '';
            if (msg.vdl2) {
                const acars = msg.vdl2?.avlc?.acars || {};
                text = `[VDLM2] ${acars.reg || 'N/A'} | ${acars.flight || 'N/A'} | ${acars.label || ''} | ${acars.msg_text || ''}`;
            } else {
                text = `[ACARS] ${msg.tail || 'N/A'} | ${msg.flight || 'N/A'} | ${msg.label || ''} | ${msg.text || ''}`;
            }
            
            div.textContent = `${new Date().toLocaleTimeString()} - ${text}`;
            container.insertBefore(div, container.firstChild);
            
            // Limit displayed messages
            while (container.children.length > 100) {
                container.removeChild(container.lastChild);
            }
        }
        
        function clearMessages() {
            document.getElementById('messages').innerHTML = '';
        }
        
        async function toggleMock() {
            mockEnabled = !mockEnabled;
            await fetch('/api/mock/' + (mockEnabled ? 'start' : 'stop'), { method: 'POST' });
            updateStats();
        }
        
        async function updateStats() {
            const resp = await fetch('/api/stats');
            const stats = await resp.json();
            document.getElementById('stats').innerHTML = `
                <strong>Statistics:</strong><br>
                Messages Received: ${stats.total_received}<br>
                Messages Generated: ${stats.total_generated}<br>
                Buffer Size: ${stats.messages_in_buffer}<br>
                WebSocket Clients: ${stats.websocket_clients}
            `;
        }
        
        connect();
        setInterval(updateStats, 2000);
        updateStats();
    </script>
</body>
</html>
"""


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for live message streaming"""
    await websocket.accept()
    message_store.websocket_clients.add(websocket)
    
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        message_store.websocket_clients.discard(websocket)


@app.get("/api/stats")
async def get_stats():
    """Get service statistics"""
    return message_store.get_stats()


@app.get("/api/messages")
async def get_messages(limit: int = 100):
    """Get recent messages"""
    return message_store.messages[-limit:]


@app.post("/api/mock/start")
async def start_mock():
    """Start mock message generation"""
    await mock_generator.start()
    return {"status": "started"}


@app.post("/api/mock/stop")
async def stop_mock():
    """Stop mock message generation"""
    await mock_generator.stop()
    return {"status": "stopped"}


class InjectMessage(BaseModel):
    """Model for injecting custom messages"""
    tail: str = "N12345"
    flight: str = "AAL123"
    label: str = "SA"
    text: str = "TEST MESSAGE"
    msg_type: str = "acars"


@app.post("/api/inject")
async def inject_message(msg: InjectMessage):
    """Inject a custom message"""
    acars_msg = ACARSMessage(
        timestamp=time.time(),
        station_id=settings.station_id,
        tail=msg.tail,
        flight=msg.flight,
        label=msg.label,
        text=msg.text,
        msg_type=msg.msg_type,
    )
    
    if msg.msg_type == "acars":
        json_msg = acars_msg.to_acarsdec_json()
    else:
        json_msg = acars_msg.to_dumpvdl2_json()
    
    await message_store.add_message(json_msg, source="injected")
    await relay_message(json_msg, msg.msg_type)
    
    return {"status": "injected", "message": json_msg}


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=settings.web_port,
        log_level="info"
    )
