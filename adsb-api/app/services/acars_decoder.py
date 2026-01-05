"""
ACARS message decoder and enrichment.
Parses callsigns to extract airline information and decodes message labels.

Uses libacars (when available) for decoding complex message formats like:
- FANS-1/A ADS-C and CPDLC
- MIAM compressed messages
- Various airline-specific encoded formats

Falls back to regex-based decoding when libacars is not available.

Based on logic from:
https://github.com/sdr-enthusiasts/docker-acarshub/blob/main/rootfs/webapp/acarshub_helpers.py
"""
import re
import logging
from functools import lru_cache
from typing import Optional

from app.data.airlines import find_airline_by_iata, find_airline_by_icao
from app.data.message_labels import lookup_label, get_label_name

# Import libacars bindings (optional - gracefully handles missing library)
try:
    from app.services import libacars_binding
    LIBACARS_AVAILABLE = libacars_binding.is_available()
except (ImportError, OSError, Exception) as e:
    # Catch any errors including C library loading issues
    libacars_binding = None
    LIBACARS_AVAILABLE = False
    logging.getLogger(__name__).debug(f"libacars not available: {e}")

logger = logging.getLogger(__name__)

if LIBACARS_AVAILABLE:
    logger.info("libacars library loaded - advanced ACARS decoding enabled")
else:
    logger.info("libacars library not available - using regex-based decoding only")


@lru_cache(maxsize=1000)
def parse_callsign(callsign: str) -> dict:
    """
    Parse a flight callsign to extract airline information.

    Callsigns can be in two formats:
    - ICAO format: 3-letter airline code + flight number (e.g., "UAL123", "BAW456")
    - IATA format: 2-letter airline code + flight number (e.g., "UA123", "BA456")

    Returns a dict with:
    - callsign: Original callsign
    - airline_code: The extracted airline code (IATA or ICAO)
    - airline_icao: The ICAO code for the airline
    - airline_iata: The IATA code for the airline (if available)
    - airline_name: Full airline name
    - flight_number: The numeric flight number portion
    - format: "icao" or "iata" or "unknown"
    """
    if not callsign:
        return {
            "callsign": None,
            "airline_code": None,
            "airline_icao": None,
            "airline_iata": None,
            "airline_name": None,
            "flight_number": None,
            "format": "unknown"
        }

    callsign = callsign.strip().upper()

    # Check if first 3 characters are all letters -> ICAO format
    if len(callsign) >= 3 and callsign[:3].isalpha():
        icao_code = callsign[:3]
        flight_num = callsign[3:].lstrip("0") if len(callsign) > 3 else ""

        iata_code, airline_name = find_airline_by_icao(icao_code)

        return {
            "callsign": callsign,
            "airline_code": icao_code,
            "airline_icao": icao_code,
            "airline_iata": iata_code if iata_code != icao_code else None,
            "airline_name": airline_name if airline_name != "Unknown Airline" else None,
            "flight_number": flight_num if flight_num else None,
            "format": "icao"
        }

    # Check if first 2 characters are alphanumeric -> IATA format
    # IATA codes can have numbers (e.g., "3K" for Jetstar Asia)
    elif len(callsign) >= 2:
        iata_code = callsign[:2]
        flight_num = callsign[2:].lstrip("0") if len(callsign) > 2 else ""

        icao_code, airline_name = find_airline_by_iata(iata_code)

        return {
            "callsign": callsign,
            "airline_code": iata_code,
            "airline_icao": icao_code if icao_code != iata_code else None,
            "airline_iata": iata_code,
            "airline_name": airline_name if airline_name != "Unknown Airline" else None,
            "flight_number": flight_num if flight_num else None,
            "format": "iata"
        }

    return {
        "callsign": callsign,
        "airline_code": None,
        "airline_icao": None,
        "airline_iata": None,
        "airline_name": None,
        "flight_number": None,
        "format": "unknown"
    }


def decode_label(label: str) -> dict:
    """
    Decode an ACARS message label to get its description.

    Returns a dict with:
    - label: The original label code
    - name: Human-readable name for the label
    - description: Detailed description (if available)
    """
    if not label:
        return {
            "label": None,
            "name": None,
            "description": None
        }

    label = label.strip()
    info = lookup_label(label)

    if info:
        return {
            "label": label,
            "name": info.get("name"),
            "description": info.get("description")
        }

    return {
        "label": label,
        "name": None,
        "description": None
    }


def validate_coordinates(lat: float, lon: float) -> bool:
    """Validate that coordinates are within valid ranges."""
    return -90 <= lat <= 90 and -180 <= lon <= 180


def parse_coordinates(text: str) -> Optional[dict]:
    """
    Parse coordinates from various ACARS message formats.

    Supports formats:
    - N12345W123456 (degrees and decimal minutes: DDMMm/DDDMMm)
    - N 49.128,W122.374 (decimal degrees with direction prefix)
    - DDMM[NS]DDDMM[EW] (degrees minutes with direction suffix)

    Returns dict with lat/lon or None if parsing failed or coordinates invalid.
    """
    if not text:
        return None

    text_clean = text.replace(' ', '').replace('\n', '').replace('\r', '')

    # Format 1: N12345W123456 (DDMMm for lat, DDDMMm for lon - tenths of minutes)
    match = re.search(r'([NS])(\d{2})(\d{3})([EW])(\d{3})(\d{3})', text_clean)
    if match:
        lat_deg = int(match.group(2))
        lat_min = int(match.group(3)) / 10
        lat = lat_deg + lat_min / 60
        if match.group(1) == 'S':
            lat = -lat

        lon_deg = int(match.group(5))
        lon_min = int(match.group(6)) / 10
        lon = lon_deg + lon_min / 60
        if match.group(4) == 'W':
            lon = -lon

        if validate_coordinates(lat, lon):
            return {"lat": round(lat, 4), "lon": round(lon, 4)}
        logger.warning(f"Invalid coordinates parsed: {lat}, {lon}")
        return None

    # Format 2: N 49.128,W122.374 (decimal degrees)
    match = re.search(r'([NS])\s*(\d+\.?\d*)\s*,\s*([EW])\s*(\d+\.?\d*)', text_clean)
    if match:
        try:
            lat = float(match.group(2))
            if match.group(1) == 'S':
                lat = -lat
            lon = float(match.group(4))
            if match.group(3) == 'W':
                lon = -lon

            if validate_coordinates(lat, lon):
                return {"lat": round(lat, 4), "lon": round(lon, 4)}
            logger.warning(f"Invalid coordinates parsed: {lat}, {lon}")
        except ValueError:
            pass
        return None

    # Format 3: DDMM[NS]DDDMM[EW] (degrees minutes with direction suffix)
    match = re.search(r'(\d{4})([NS])(\d{5})([EW])', text_clean)
    if match:
        lat_deg = int(match.group(1)[:2])
        lat_min = int(match.group(1)[2:])
        lat = lat_deg + lat_min / 60
        if match.group(2) == 'S':
            lat = -lat

        lon_deg = int(match.group(3)[:3])
        lon_min = int(match.group(3)[3:])
        lon = lon_deg + lon_min / 60
        if match.group(4) == 'W':
            lon = -lon

        if validate_coordinates(lat, lon):
            return {"lat": round(lat, 4), "lon": round(lon, 4)}
        logger.warning(f"Invalid coordinates parsed: {lat}, {lon}")
        return None

    return None


def decode_h1_message(text: str) -> dict | None:
    """
    Decode H1 (Datalink) message sub-types.

    H1 messages have various preambles identifying the message type:
    - FPN: Flight Plan
    - POS: Position Report
    - PRG: Progress Report
    - PWI: Predicted Wind
    - WRN: Warning
    - FLR: Fault Log Report
    - INI: Initialization
    - P0S/PDC: Pre-Departure Clearance with position
    - RPT: Maintenance/System Report

    Returns decoded dict or None if format not recognized.
    """
    if not text:
        return None

    decoded = {}
    text_clean = text.replace('\n', '').replace('\r', '')

    # ========== P0S/PDC - Pre-Departure Clearance with Position ==========
    # Format: P0SN47379W122205,VASHN,005642,30,FINKA,005822,RW16R,P1,206022,85,172,189K,180K,7306E2
    # Alaska Airlines style PDC with embedded coordinates
    pdc_match = re.match(r'^P0S([NS])(\d{5})([EW])(\d{6})', text_clean)
    if pdc_match:
        decoded["message_type"] = "Pre-Departure Clearance"
        decoded["description"] = "PDC with route and clearance data"

        # Parse position (format: DDMM.M for lat, DDDMM.M for lon - tenths of minutes)
        lat_raw = pdc_match.group(2)  # e.g., "47379" = 47° 37.9'
        lon_raw = pdc_match.group(4)  # e.g., "122205" = 122° 20.5'

        lat_deg = int(lat_raw[:2])
        lat_min = int(lat_raw[2:]) / 10
        lat = lat_deg + lat_min / 60
        if pdc_match.group(1) == 'S':
            lat = -lat

        lon_deg = int(lon_raw[:3])
        lon_min = int(lon_raw[3:]) / 10
        lon = lon_deg + lon_min / 60
        if pdc_match.group(3) == 'W':
            lon = -lon

        decoded["position"] = {"lat": round(lat, 4), "lon": round(lon, 4)}

        # Parse comma-separated fields for waypoints, runway, etc.
        fields = text_clean.split(',')
        waypoints = []
        for field in fields:
            # Extract 5-letter waypoints
            wp_matches = re.findall(r'\b([A-Z]{5})\b', field)
            waypoints.extend(wp_matches)
            # Extract runway (RWxxL/R/C)
            rw_match = re.search(r'RW(\d{2}[LRC]?)', field)
            if rw_match:
                decoded["runway"] = rw_match.group(1)

        if waypoints:
            decoded["waypoints"] = list(dict.fromkeys(waypoints))[:10]
            decoded["route"] = ' → '.join(decoded["waypoints"][:8])

        return decoded

    # ========== RPT - System/Maintenance Report ==========
    # Format: /BOLIXA. A RPT12 PG1  L-ECS AIR COND SYS REAL
    # or: A RPT12 PG1 ... B N407KZ 05JAN26 0054 GTI7170 PANC/KDFW
    rpt_match = re.search(r'RPT(\d+)\s+(?:PG\d+)?\s*(.+?)(?:\s+B\s+|$)', text_clean)
    if rpt_match or 'RPT' in text_clean:
        decoded["message_type"] = "System Report"
        decoded["description"] = "Aircraft system or maintenance report"

        if rpt_match:
            decoded["report_type"] = f"RPT{rpt_match.group(1)}"
            report_text = rpt_match.group(2).strip() if rpt_match.group(2) else None
            if report_text:
                decoded["report_content"] = report_text

        # Look for ECS, APU, ENG, etc. system identifiers
        system_match = re.search(r'(L-ECS|R-ECS|ECS|APU|ENG\d?|PACK\d?|BLEED|HYD|ELEC)', text_clean)
        if system_match:
            decoded["system"] = system_match.group(1)

        # Extract flight info if present (format: B N407KZ 05JAN26 0054 GTI7170 PANC/KDFW)
        flight_match = re.search(r'\bB\s+([A-Z0-9-]+)\s+\d{2}[A-Z]{3}\d{2}\s+\d{4}\s+([A-Z]{3}\d+)\s+([A-Z]{4})/([A-Z]{4})', text_clean)
        if flight_match:
            decoded["registration"] = flight_match.group(1)
            decoded["flight_id"] = flight_match.group(2)
            decoded["origin"] = flight_match.group(3)
            decoded["destination"] = flight_match.group(4)

        # Extract airports mentioned
        airports = re.findall(r'\b([A-Z]{4})/([A-Z]{4})\b', text_clean)
        if airports:
            decoded["origin"] = airports[0][0]
            decoded["destination"] = airports[0][1]

        return decoded

    # ========== DR - Departure Route Messages ==========
    # Format: YVRE2YA.DR1.N407KZ7FD6
    dr_match = re.match(r'^([A-Z]{4}[A-Z0-9]+)\.DR(\d+)\.([A-Z0-9]+)', text_clean)
    if dr_match:
        decoded["message_type"] = "Departure Route"
        decoded["description"] = "Departure routing message"
        decoded["route_id"] = dr_match.group(1)
        decoded["departure_route"] = f"DR{dr_match.group(2)}"
        decoded["flight_ref"] = dr_match.group(3)

        # Try to extract registration from flight_ref
        reg_match = re.search(r'([A-Z]-?[A-Z0-9]{3,5})', dr_match.group(3))
        if reg_match:
            decoded["registration"] = reg_match.group(1)

        return decoded

    # ========== FPN - Flight Plan ==========
    # Format: FPN/RI:DA:KEWR:AA:KDFW:CR:... or #M1BFPN/...
    fpn_match = re.search(r'(?:#[A-Z0-9]+)?FPN/([A-Z0-9]+/)?(?:RI:)?(?:DA:)?([A-Z]{4}):(?:AA:)?([A-Z]{4})', text_clean)
    if fpn_match or 'FPN/' in text_clean:
        decoded["message_type"] = "Flight Plan"
        decoded["description"] = "FPN flight plan/route data"

        # Extract origin/destination
        da_match = re.search(r'DA:([A-Z]{4})', text_clean)
        aa_match = re.search(r'AA:([A-Z]{4})', text_clean)
        if da_match:
            decoded["origin"] = da_match.group(1)
        if aa_match:
            decoded["destination"] = aa_match.group(1)

        # Extract runway info
        dr_match = re.search(r'DR:([A-Z0-9]+)', text_clean)  # Departure runway
        ar_match = re.search(r'AR:([A-Z0-9]+)', text_clean)  # Arrival runway
        if dr_match:
            decoded["departure_runway"] = dr_match.group(1)
        if ar_match:
            decoded["arrival_runway"] = ar_match.group(1)

        # Extract waypoints from route - format like F:KCLT..KILNS..ZORAK
        route_match = re.search(r'F:([A-Z0-9./]+)', text_clean)
        if route_match:
            route_str = route_match.group(1)
            waypoints = re.findall(r'([A-Z]{3,5})', route_str)
            if waypoints:
                decoded["route"] = ' → '.join(waypoints[:10])
                decoded["waypoints"] = waypoints[:10]

        # Extract company route
        cr_match = re.search(r'CR:([A-Z0-9]+)', text_clean)
        if cr_match:
            decoded["company_route"] = cr_match.group(1)

        # Extract ETA
        eta_match = re.search(r'ETA:?(\d{4})', text_clean)
        if eta_match:
            eta = eta_match.group(1)
            decoded["eta"] = f"{eta[:2]}:{eta[2:]}"

        return decoded

    # ========== POS - Position Report ==========
    # Format: /..POS/TS... or #M1BPOS/...
    if '/POS/' in text_clean or re.match(r'^[A-Z0-9#]*POS/', text_clean):
        decoded["message_type"] = "Position Report"
        decoded["description"] = "H1 position report"

        # Extract timestamp - TS140017,021724 (HHMMSS,DDMMYY)
        ts_match = re.search(r'TS(\d{6}),(\d{6})', text_clean)
        if ts_match:
            time_str = ts_match.group(1)
            decoded["time"] = f"{time_str[:2]}:{time_str[2:4]}:{time_str[4:]} UTC"

        # Extract position - format varies
        # Try N12345W123456 format (degrees and decimal minutes)
        # Pattern: N/S + 2 deg + 3 min, E/W + 3 deg + 3 min
        pos_match = re.search(r'([NS])(\d{2})(\d{3})([EW])(\d{3})(\d{3})', text_clean)
        if pos_match:
            lat_deg = int(pos_match.group(2))
            lat_min = int(pos_match.group(3)) / 10
            lat = lat_deg + lat_min / 60
            if pos_match.group(1) == 'S':
                lat = -lat

            lon_deg = int(pos_match.group(5))  # Fixed: was group(4) which is E/W direction
            lon_min = int(pos_match.group(6)) / 10
            lon = lon_deg + lon_min / 60
            if pos_match.group(4) == 'W':
                lon = -lon

            decoded["position"] = {"lat": round(lat, 4), "lon": round(lon, 4)}

        # Extract altitude
        alt_match = re.search(r'/A(\d{5})', text_clean)
        if alt_match:
            decoded["altitude_ft"] = int(alt_match.group(1))
            decoded["flight_level"] = f"FL{int(alt_match.group(1)) // 100}"

        # Extract Mach number
        mach_match = re.search(r'/M(\d{3})', text_clean)
        if mach_match:
            decoded["mach"] = f"0.{mach_match.group(1)}"

        return decoded

    # ========== PRG - Progress Report ==========
    # Format: PRG/FMWJA120/DTCYYC,17L,94,043427,3056B5
    if 'PRG/' in text_clean:
        decoded["message_type"] = "Progress Report"
        decoded["description"] = "Flight progress update"

        prg_match = re.search(r'PRG/([A-Z0-9]+)/DT([A-Z]{4}),([^,]+),(\d+),(\d+)', text_clean)
        if prg_match:
            decoded["progress_id"] = prg_match.group(1)
            decoded["destination"] = prg_match.group(2)
            decoded["runway"] = prg_match.group(3)
            decoded["sequence"] = prg_match.group(4)

        # Extract ETA
        eta_match = re.search(r'ETA:?(\d{4})', text_clean)
        if eta_match:
            eta = eta_match.group(1)
            decoded["eta"] = f"{eta[:2]}:{eta[2:]}"

        return decoded

    # ========== PWI - Predicted Wind Information ==========
    if 'PWI/' in text_clean or 'REQPWI' in text_clean:
        decoded["message_type"] = "Wind Information"
        decoded["description"] = "Predicted wind data request/response"

        # Extract waypoint and altitude
        pwi_match = re.search(r'([A-Z]{5})/([A-Z]{2}\d+)', text_clean)
        if pwi_match:
            decoded["waypoint"] = pwi_match.group(1)
            decoded["flight_id"] = pwi_match.group(2)

        return decoded

    # ========== WRN - Warning Message ==========
    if '/WRN/' in text_clean or text_clean.startswith('WRN/'):
        decoded["message_type"] = "Warning"
        decoded["description"] = "System warning message"

        # Extract warning code if present
        wrn_match = re.search(r'WRN/([A-Z0-9]+)', text_clean)
        if wrn_match:
            decoded["warning_code"] = wrn_match.group(1)

        return decoded

    # ========== FLR - Fault Log Report ==========
    # Format: FLR/[system]/[fault code]/[description]
    if 'FLR/' in text_clean or '/FLR' in text_clean:
        decoded["message_type"] = "Fault Log Report"
        decoded["description"] = "Aircraft system fault report"

        # Extract fault details
        flr_match = re.search(r'FLR/([A-Z0-9]+)', text_clean)
        if flr_match:
            decoded["fault_code"] = flr_match.group(1)

        # Extract system identifier (often ATA chapter)
        ata_match = re.search(r'ATA:?(\d{2,4})', text_clean)
        if ata_match:
            decoded["ata_chapter"] = ata_match.group(1)

        # Extract fault text/description
        fault_text_match = re.search(r'FLR/[^/]+/(.+?)(?:/|$)', text_clean)
        if fault_text_match:
            decoded["fault_text"] = fault_text_match.group(1).strip()

        # Extract LRU (Line Replaceable Unit) if present
        lru_match = re.search(r'LRU:?([A-Z0-9-]+)', text_clean)
        if lru_match:
            decoded["lru"] = lru_match.group(1)

        return decoded

    # ========== INI - Initialization ==========
    # Format: INI/[flight info]/[route]
    if 'INI/' in text_clean or '/INI' in text_clean:
        decoded["message_type"] = "Initialization"
        decoded["description"] = "Flight initialization message"

        # Extract flight number
        flt_match = re.search(r'FI:?([A-Z0-9]+)', text_clean)
        if flt_match:
            decoded["flight_id"] = flt_match.group(1)

        # Extract origin/destination
        da_match = re.search(r'DA:([A-Z]{4})', text_clean)
        aa_match = re.search(r'AA:([A-Z]{4})', text_clean)
        if da_match:
            decoded["origin"] = da_match.group(1)
        if aa_match:
            decoded["destination"] = aa_match.group(1)

        # Extract date
        dt_match = re.search(r'DT:?(\d{6})', text_clean)
        if dt_match:
            dt = dt_match.group(1)
            decoded["date"] = f"{dt[:2]}/{dt[2:4]}/{dt[4:]}"

        return decoded

    # ========== ETA - Estimated Time of Arrival ==========
    # Format: ETA/[airport]/[time]
    if 'ETA/' in text_clean or re.search(r'\bETA\s*[:=]?\s*\d{4}', text_clean):
        decoded["message_type"] = "ETA Update"
        decoded["description"] = "Estimated time of arrival update"

        # Extract ETA time
        eta_match = re.search(r'ETA\s*[:=/]?\s*(\d{4})', text_clean)
        if eta_match:
            eta = eta_match.group(1)
            decoded["eta"] = f"{eta[:2]}:{eta[2:]}"

        # Extract destination airport
        dest_match = re.search(r'ETA/([A-Z]{4})', text_clean)
        if not dest_match:
            dest_match = re.search(r'([A-Z]{4})\s*ETA', text_clean)
        if dest_match:
            decoded["destination"] = dest_match.group(1)

        # Extract fuel remaining if present
        fuel_match = re.search(r'FUEL:?\s*(\d+)', text_clean)
        if fuel_match:
            decoded["fuel_remaining"] = int(fuel_match.group(1))

        return decoded

    # ========== CMD - Command Message ==========
    # Format: CMD/[command type]/[parameters]
    if 'CMD/' in text_clean or '/CMD' in text_clean:
        decoded["message_type"] = "Command"
        decoded["description"] = "System command message"

        # Extract command type
        cmd_match = re.search(r'CMD/([A-Z0-9]+)', text_clean)
        if cmd_match:
            decoded["command_type"] = cmd_match.group(1)

        # Extract parameters
        param_match = re.search(r'CMD/[^/]+/(.+?)(?:/|$)', text_clean)
        if param_match:
            decoded["parameters"] = param_match.group(1).strip()

        return decoded

    # ========== RTE - Route Request/Update ==========
    if 'RTE/' in text_clean or '/RTE' in text_clean:
        decoded["message_type"] = "Route Update"
        decoded["description"] = "Route information request or update"

        # Extract waypoints
        waypoints = re.findall(r'\b([A-Z]{5})\b', text_clean)
        if waypoints:
            decoded["waypoints"] = list(dict.fromkeys(waypoints))[:15]
            decoded["route"] = ' → '.join(decoded["waypoints"][:10])

        return decoded

    # ========== CFB - Clearance from Tower ==========
    if '#CFB' in text_clean or 'CFB/' in text_clean:
        decoded["message_type"] = "Clearance"
        decoded["description"] = "Departure clearance from tower"

        # Extract clearance limit
        cl_match = re.search(r'/CL([A-Z0-9]+)', text_clean)
        if cl_match:
            decoded["clearance_limit"] = cl_match.group(1)

        # Extract SID
        sid_match = re.search(r'/([A-Z0-9]+)\.([A-Z0-9]+)', text_clean)
        if sid_match:
            decoded["sid"] = f"{sid_match.group(1)}.{sid_match.group(2)}"

        return decoded

    # ========== Performance/Telemetry Data ==========
    # Format: 0.99 1.00 0.99\n 15 0.60 0.49 0.27\n 16 0.93 0.91 0.81\n ...
    # Numeric rows with line numbers and decimal values
    # Also matches tabular data with timestamps like "22 05JAN26 00:54:57"
    lines = text.strip().split('\n')
    numeric_line_count = 0
    has_line_numbers = False
    for line in lines:
        line = line.strip()
        # Check if line starts with a number (line number) or is mostly numeric
        if re.match(r'^\d+\s', line) or re.match(r'^[\d.\s]+$', line):
            numeric_line_count += 1
        if re.match(r'^\s*\d{1,2}\s+', line):
            has_line_numbers = True

    if numeric_line_count >= 3 and has_line_numbers:
        decoded["message_type"] = "Performance Data"
        decoded["description"] = "Aircraft performance or telemetry data"

        # Try to extract timestamp if present (format: 22 05JAN26 00:54:57)
        ts_match = re.search(r'(\d{2}[A-Z]{3}\d{2})\s+(\d{2}:\d{2}:\d{2})', text)
        if ts_match:
            decoded["data_timestamp"] = f"{ts_match.group(1)} {ts_match.group(2)}"

        # Count data rows
        decoded["data_rows"] = numeric_line_count

        return decoded

    # ========== Generic slash-separated H1 format ==========
    # Many H1 messages use slash-separated fields
    if '/' in text_clean and len(text_clean) > 10:
        fields = text_clean.split('/')
        if len(fields) >= 3:
            decoded["message_type"] = "H1 Data"
            decoded["description"] = "Encoded datalink message"

            # Try to identify airports in fields
            airports = []
            for field in fields:
                airport_matches = re.findall(r'\b([CKPEGLS][A-Z]{3})\b', field)
                airports.extend(airport_matches)
            if airports:
                decoded["airports"] = list(dict.fromkeys(airports))[:5]

            # Extract waypoints
            waypoints = []
            for field in fields:
                wp_matches = re.findall(r'\b([A-Z]{5})\b', field)
                waypoints.extend(wp_matches)
            if waypoints:
                decoded["waypoints"] = list(dict.fromkeys(waypoints))[:10]

            if decoded.get("airports") or decoded.get("waypoints"):
                return decoded

    # ========== Generic comma-separated format ==========
    # Many H1 messages use comma-separated fields with waypoints/airports
    if ',' in text_clean and len(text_clean) > 10:
        fields = text_clean.split(',')
        if len(fields) >= 3:
            waypoints = []
            airports = []
            for field in fields:
                # Extract 5-letter waypoints
                wp_matches = re.findall(r'\b([A-Z]{5})\b', field)
                waypoints.extend(wp_matches)
                # Extract 4-letter airport codes
                apt_matches = re.findall(r'\b([CKPEGLS][A-Z]{3})\b', field)
                airports.extend(apt_matches)

            if waypoints or airports:
                decoded["message_type"] = "H1 Data"
                decoded["description"] = "Encoded datalink message"
                if waypoints:
                    decoded["waypoints"] = list(dict.fromkeys(waypoints))[:10]
                if airports:
                    decoded["airports"] = list(dict.fromkeys(airports))[:5]
                return decoded

    return None


def try_libacars_decode(label: str, text: str) -> dict | None:
    """
    Try to decode message using libacars library.

    This handles complex encoded formats that cannot be decoded with regex,
    such as FANS-1/A ADS-C, CPDLC, and MIAM messages.

    Returns decoded dict or None if libacars is not available or decoding failed.
    """
    if not LIBACARS_AVAILABLE or not libacars_binding:
        return None

    if not label or not text:
        return None

    try:
        # Try to decode using libacars
        libacars_json = libacars_binding.decode_acars_apps(label, text)

        if not libacars_json:
            return None

        decoded = {}
        decoded["message_type"] = "Decoded (libacars)"
        decoded["libacars_decoded"] = libacars_json

        # Extract common fields from libacars JSON output
        # The structure varies by message type (ADS-C, CPDLC, etc.)

        # Check for ADS-C data
        if "adsc" in libacars_json:
            adsc = libacars_json["adsc"]
            decoded["message_type"] = "ADS-C"
            decoded["description"] = "Automatic Dependent Surveillance - Contract"

            # Extract position if present
            if "basic_report" in adsc:
                report = adsc["basic_report"]
                if "lat" in report and "lon" in report:
                    decoded["position"] = {
                        "lat": report["lat"],
                        "lon": report["lon"]
                    }
                if "alt" in report:
                    decoded["altitude_ft"] = report["alt"]
                    decoded["flight_level"] = f"FL{report['alt'] // 100}"

        # Check for CPDLC data
        if "cpdlc" in libacars_json:
            cpdlc = libacars_json["cpdlc"]
            decoded["message_type"] = "CPDLC"
            decoded["description"] = "Controller-Pilot Data Link Communications"

            # Extract message text if present
            if "msg_text" in cpdlc:
                decoded["cpdlc_text"] = cpdlc["msg_text"]

        # Check for MIAM data
        if "miam" in libacars_json:
            decoded["message_type"] = "MIAM"
            decoded["description"] = "Media Independent Aircraft Messaging"

        # Get formatted text output
        formatted = libacars_binding.decode_acars_apps_text(label, text)
        if formatted:
            decoded["libacars_formatted"] = formatted.strip()

        return decoded if len(decoded) > 1 else None

    except Exception as e:
        logger.debug(f"libacars decode failed for label {label}: {e}")
        return None


def decode_message_text(text: str, label: str = None, libacars_data: dict = None) -> dict:
    """
    Attempt to decode the text content of an ACARS message.

    Different message types have different text formats:
    - Position reports may contain coordinates
    - OOOI messages contain timestamps
    - Weather messages contain METAR/TAF data
    - Ground station squitter messages
    - ATIS data

    Returns a dict with decoded fields based on message type.
    """
    if not text:
        return {}

    decoded = {}
    text_stripped = text.strip()
    text_upper = text_stripped.upper()

    # Check for libacars decoded data first (if available from dumpvdl2/acarsdec)
    if libacars_data:
        decoded["libacars"] = libacars_data

    # ========== Ground Station Squitter (Media Advisory) ==========
    # Format: 02X[S/A][ABQ]KABQ[0/1]3502N10636WV136975/[ARINC/SITA]
    # Pattern: Version + Network type + Ground station + coordinates + frequency + network
    gs_pattern = r'^(\d{2})X([SA])([A-Z]{3})([A-Z]{4})(\d)(\d{4})([NS])(\d{5})([EW])V(\d{6})/?(.*)$'
    gs_match = re.match(gs_pattern, text_stripped.replace(' ', ''))
    if gs_match:
        version = gs_match.group(1)
        network_type = 'SITA' if gs_match.group(2) == 'S' else 'ARINC'
        iata_code = gs_match.group(3)
        icao_code = gs_match.group(4)
        gs_num = gs_match.group(5)
        # Format: DDMM for lat (4 digits), DDDMM for lon (5 digits)
        lat_deg = int(gs_match.group(6)[:2])
        lat_min = int(gs_match.group(6)[2:])  # Raw minutes (0-59)
        lat_dir = gs_match.group(7)
        lon_deg = int(gs_match.group(8)[:3])
        lon_min = int(gs_match.group(8)[3:])  # Raw minutes (0-59)
        lon_dir = gs_match.group(9)
        freq = int(gs_match.group(10)) / 1000  # Convert to MHz
        extra = gs_match.group(11)

        lat = lat_deg + lat_min / 60  # Convert minutes to decimal degrees
        if lat_dir == 'S':
            lat = -lat
        lon = lon_deg + lon_min / 60  # Convert minutes to decimal degrees
        if lon_dir == 'W':
            lon = -lon

        decoded["message_type"] = "Ground Station Squitter"
        decoded["description"] = f"Ground station identification broadcast"
        decoded["ground_station"] = f"{icao_code}{gs_num}"
        decoded["iata"] = iata_code
        decoded["icao"] = icao_code
        decoded["network"] = network_type
        decoded["version"] = int(version)
        decoded["frequency"] = f"{freq:.3f} MHz"
        decoded["location"] = {"lat": round(lat, 4), "lon": round(lon, 4)}
        if extra:
            decoded["extra"] = extra
        return decoded

    # ========== Position Report Decoding ==========
    # Format: N 49.128,W122.374,37000,033758, 129,.C-FMWJ,0429
    # More flexible pattern to handle varying spaces
    pos_pattern = r'^([NS])\s*(\d+\.?\d*)\s*,\s*([EW])\s*(\d+\.?\d*)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\.?([A-Z0-9-]+)\s*,\s*(\d+)$'
    pos_match = re.match(pos_pattern, text_stripped)
    if pos_match:
        lat = float(pos_match.group(2))
        if pos_match.group(1) == 'S':
            lat = -lat
        lon = float(pos_match.group(4))
        if pos_match.group(3) == 'W':
            lon = -lon
        altitude = int(pos_match.group(5))
        time_val = pos_match.group(6)
        groundspeed = int(pos_match.group(7))
        registration = pos_match.group(8)
        eta_or_extra = pos_match.group(9)

        decoded["message_type"] = "Position Report"
        decoded["description"] = f"Aircraft position at FL{altitude // 100}"
        decoded["position"] = {"lat": lat, "lon": lon}
        decoded["altitude_ft"] = altitude
        decoded["flight_level"] = f"FL{altitude // 100}"
        decoded["groundspeed_kts"] = groundspeed
        decoded["registration"] = registration
        decoded["time"] = f"{time_val[:2]}:{time_val[2:4]}:{time_val[4:]}" if len(time_val) >= 6 else time_val
        return decoded

    # ========== ATIS Message Decoding (Label 33) ==========
    # These typically contain weather/runway info in a coded format
    if label == "33":
        decoded["message_type"] = "ATIS"
        decoded["description"] = "Automatic Terminal Information Service"
        # Try to extract ATIS letter if present
        atis_letter = re.search(r'\bATIS\s+([A-Z])\b', text_upper)
        if atis_letter:
            decoded["atis_code"] = atis_letter.group(1)
        # Extract airports mentioned
        airports = re.findall(r'\b([A-Z]{4})\b', text_stripped)
        airport_codes = [a for a in airports if a[0] == 'K' or a[0] in 'CEMPV']  # Common prefixes
        if airport_codes:
            decoded["airports"] = list(set(airport_codes))

    # ========== Pre-Departure Clearance / H1 Messages ==========
    # H1 messages have sub-types identified by preambles: FPN, POS, PRG, PWI, WRN, etc.
    if label == "H1":
        h1_decoded = decode_h1_message(text_stripped)
        if h1_decoded:
            decoded.update(h1_decoded)
        else:
            # Try libacars for complex encoded H1 messages
            libacars_result = try_libacars_decode(label, text_stripped)
            if libacars_result:
                decoded.update(libacars_result)
            else:
                # Fallback for unrecognized H1 formats
                decoded["message_type"] = "H1 Message"
                decoded["description"] = "Datalink message"

                # Extract airports (4-letter ICAO codes starting with common prefixes)
                airports = re.findall(r'\b([CKPEGLS][A-Z]{3})\b', text_stripped)
                if airports:
                    decoded["airports"] = list(dict.fromkeys(airports))[:5]

                # Extract waypoints (5-letter codes)
                waypoints = re.findall(r'\b([A-Z]{5})\b', text_stripped)
                if waypoints:
                    decoded["waypoints"] = list(dict.fromkeys(waypoints))[:10]

    # ========== Label B9 - General Communication ==========
    if label == "B9":
        decoded["message_type"] = "General Communication"
        decoded["description"] = "Miscellaneous operational message"
        # Format often: /CYYC.TI2/040CYYCAA6A1
        # Extract airport codes
        airports = re.findall(r'\b([CKPE][A-Z]{3})\b', text_stripped)
        if airports:
            decoded["airports"] = list(dict.fromkeys(airports))[:5]

    # ========== Weather Request/Data ==========
    if label in ("QA", "QB", "QC", "QD", "QE", "QF", "Q0", "Q1", "Q2"):
        decoded["message_type"] = "Weather"
        decoded["description"] = "Weather data request or report"
        # Look for METAR/TAF markers
        if "METAR" in text_upper:
            decoded["weather_type"] = "METAR"
        elif "TAF" in text_upper:
            decoded["weather_type"] = "TAF"

    # ========== OOOI Events (Label 80/10/11/12/13) ==========
    oooi_labels = {"10": "Out", "11": "Off", "12": "On", "13": "In", "80": "OOOI"}
    if label in oooi_labels:
        decoded["message_type"] = "OOOI Event"
        decoded["event_type"] = oooi_labels[label]
        decoded["description"] = f"Flight phase: {oooi_labels[label]}"

        # OOOI messages with label 12 often contain position reports
        # Format: N 49.128,W122.374,37000,033758, 129,.C-FMWJ,0429
        oooi_pos = re.search(r'([NS])\s*(\d+\.?\d*)\s*,\s*([EW])\s*(\d+\.?\d*)\s*,\s*(\d+)', text_stripped)
        if oooi_pos:
            lat = float(oooi_pos.group(2))
            if oooi_pos.group(1) == 'S':
                lat = -lat
            lon = float(oooi_pos.group(4))
            if oooi_pos.group(3) == 'W':
                lon = -lon
            altitude = int(oooi_pos.group(5))
            decoded["position"] = {"lat": lat, "lon": lon}
            decoded["altitude_ft"] = altitude
            decoded["flight_level"] = f"FL{altitude // 100}"
            decoded["description"] = f"Flight phase: {oooi_labels[label]} at FL{altitude // 100}"

        # Extract registration if present (.C-FMWJ format)
        reg_match = re.search(r'\.([A-Z]-[A-Z0-9]+)', text_stripped)
        if reg_match:
            decoded["registration"] = reg_match.group(1)

        # Extract times
        time_pattern = r'\b(\d{2}):?(\d{2})\b'
        times = re.findall(time_pattern, text_stripped)
        if times:
            decoded["times"] = [f"{t[0]}:{t[1]}" for t in times[:4]]

    # ========== Free Text / General decoding ==========
    # Try to extract common patterns for any message type

    # Departure/Destination airports (4-letter ICAO codes)
    if "airports_mentioned" not in decoded and "airports" not in decoded:
        airport_pattern = r'\b([A-Z]{4})\b'
        airports = re.findall(airport_pattern, text_stripped)
        if airports:
            # Filter out common non-airport matches
            valid_airports = [a for a in airports if not a.startswith(('ACMS', 'BITE', 'OOOI', 'CREW', 'PAGE', 'TEXT', 'INFO'))]
            if valid_airports:
                decoded["airports_mentioned"] = list(set(valid_airports))

    # Coordinates pattern (various formats)
    if "position" not in decoded:
        # Format: N4512.3W12345.6 or similar
        coord_pattern = r'([NS])(\d{2,4})\.?(\d*)[,\s]*([EW])(\d{2,5})\.?(\d*)'
        coord_match = re.search(coord_pattern, text_stripped)
        if coord_match:
            try:
                lat = float(f"{coord_match.group(2)}.{coord_match.group(3)}")
                lon = float(f"{coord_match.group(5)}.{coord_match.group(6)}")
                if coord_match.group(1) == 'S':
                    lat = -lat
                if coord_match.group(4) == 'W':
                    lon = -lon
                decoded["position"] = {"lat": round(lat, 4), "lon": round(lon, 4)}
            except ValueError:
                pass

    # Altitude/Flight level pattern
    if "flight_level" not in decoded:
        alt_pattern = r'\b(?:FL|F/L|ALT)\s*(\d{2,3})\b'
        alts = re.findall(alt_pattern, text_stripped, re.IGNORECASE)
        if alts:
            decoded["flight_levels"] = [f"FL{a}" for a in alts]

    # Fuel values
    if 'FUEL' in text_upper:
        fuel_pattern = r'\b(\d{4,6})\s*(?:LBS?|KGS?|#)?\b'
        fuels = re.findall(fuel_pattern, text_stripped)
        if fuels:
            decoded["fuel_lbs"] = [int(f) for f in fuels[:3]]

    # ETA pattern
    eta_pattern = r'\bETA\s*(\d{2}):?(\d{2})\b'
    eta_match = re.search(eta_pattern, text_upper)
    if eta_match:
        decoded["eta"] = f"{eta_match.group(1)}:{eta_match.group(2)}"

    return decoded


def format_decoded_text(decoded: dict) -> str:
    """
    Format decoded message data into human-readable text lines.

    Returns a formatted string for display.
    """
    if not decoded:
        return ""

    # Skip formatting if there's not enough meaningful data
    # Only format if we have actual decoded content (not just message_type)
    has_meaningful_data = (
        decoded.get("ground_station") or
        decoded.get("position") or
        decoded.get("location") or
        decoded.get("destination") or
        decoded.get("origin") or
        decoded.get("route") or
        decoded.get("waypoints") or
        decoded.get("altitude_ft") or
        decoded.get("clearance_limit") or
        decoded.get("sid") or
        decoded.get("company_route") or
        decoded.get("libacars_formatted") or
        decoded.get("cpdlc_text") or
        decoded.get("runway") or
        decoded.get("system") or
        decoded.get("report_content") or
        decoded.get("data_rows") or
        decoded.get("departure_route") or
        decoded.get("airports")
    )
    if not has_meaningful_data:
        return ""

    lines = []

    # Message type header
    if decoded.get("message_type"):
        lines.append(f"Type: {decoded['message_type']}")

    if decoded.get("description"):
        lines.append(decoded['description'])

    # Ground station info
    if decoded.get("ground_station"):
        lines.append(f"Ground Station: {decoded['ground_station']}")
    if decoded.get("network"):
        lines.append(f"Network: {decoded['network']}")
    if decoded.get("version"):
        lines.append(f"Version: {decoded['version']}")

    # Location info
    if decoded.get("location"):
        loc = decoded["location"]
        lines.append(f"Location: {loc['lat']:.4f}, {loc['lon']:.4f}")
    elif decoded.get("position"):
        pos = decoded["position"]
        lines.append(f"Position: {pos['lat']:.4f}, {pos['lon']:.4f}")

    # Frequency
    if decoded.get("frequency"):
        lines.append(f"Frequency: {decoded['frequency']}")

    # Flight info
    if decoded.get("altitude_ft"):
        lines.append(f"Altitude: {decoded['altitude_ft']:,} ft ({decoded.get('flight_level', '')})")
    elif decoded.get("flight_level"):
        lines.append(f"Altitude: {decoded['flight_level']}")
    if decoded.get("groundspeed_kts"):
        lines.append(f"Ground Speed: {decoded['groundspeed_kts']} kts")
    if decoded.get("registration"):
        lines.append(f"Registration: {decoded['registration']}")
    if decoded.get("time"):
        lines.append(f"Time: {decoded['time']} UTC")

    # Flight Plan / Route info
    if decoded.get("origin"):
        lines.append(f"Origin: {decoded['origin']}")
    if decoded.get("destination"):
        lines.append(f"Destination: {decoded['destination']}")
    if decoded.get("departure_runway"):
        lines.append(f"Departure Runway: {decoded['departure_runway']}")
    if decoded.get("arrival_runway"):
        lines.append(f"Arrival Runway: {decoded['arrival_runway']}")
    if decoded.get("runway"):
        lines.append(f"Runway: {decoded['runway']}")

    # Clearance info
    if decoded.get("clearance_limit"):
        lines.append(f"Clearance Limit: {decoded['clearance_limit']}")
    if decoded.get("sid"):
        lines.append(f"SID: {decoded['sid']}")
    if decoded.get("company_route"):
        lines.append(f"Company Route: {decoded['company_route']}")

    if decoded.get("request_type"):
        lines.append(f"Request: {decoded['request_type']}")
    if decoded.get("flight_id"):
        lines.append(f"Flight ID: {decoded['flight_id']}")

    # Route info
    if decoded.get("route"):
        lines.append(f"Route: {decoded['route']}")
    if decoded.get("waypoints"):
        lines.append(f"Waypoints: {', '.join(decoded['waypoints'][:8])}")

    # Airports
    if decoded.get("airports") or decoded.get("airports_mentioned"):
        airports = decoded.get("airports") or decoded.get("airports_mentioned")
        lines.append(f"Airports: {', '.join(airports[:5])}")

    # OOOI event info
    if decoded.get("event_type"):
        lines.append(f"Event: {decoded['event_type']}")

    # Times
    if decoded.get("eta"):
        lines.append(f"ETA: {decoded['eta']}")
    if decoded.get("times"):
        lines.append(f"Times: {', '.join(decoded['times'])}")

    # System/Maintenance report info
    if decoded.get("system"):
        lines.append(f"System: {decoded['system']}")
    if decoded.get("report_type"):
        lines.append(f"Report: {decoded['report_type']}")
    if decoded.get("report_content"):
        lines.append(f"Content: {decoded['report_content']}")

    # Performance/Telemetry data
    if decoded.get("data_rows"):
        lines.append(f"Data Rows: {decoded['data_rows']}")
    if decoded.get("data_timestamp"):
        lines.append(f"Data Time: {decoded['data_timestamp']}")

    # Departure route info
    if decoded.get("departure_route"):
        lines.append(f"Departure Route: {decoded['departure_route']}")
    if decoded.get("route_id"):
        lines.append(f"Route ID: {decoded['route_id']}")

    # CPDLC text
    if decoded.get("cpdlc_text"):
        lines.append(f"CPDLC: {decoded['cpdlc_text']}")

    # libacars formatted output (if we decoded with libacars)
    if decoded.get("libacars_formatted"):
        # Add libacars output, but avoid duplication if we already have info
        if len(lines) <= 2:  # Only type and description
            lines.append(decoded["libacars_formatted"])

    return "\n".join(lines)


def enrich_acars_message(msg: dict) -> dict:
    """
    Enrich an ACARS message with decoded information.

    Takes a normalized ACARS message dict and adds:
    - airline: Airline information parsed from callsign
    - label_info: Decoded label information
    - decoded_text: Parsed text content (if applicable)
    - formatted_text: Human-readable formatted text

    Returns the enriched message dict.
    """
    enriched = dict(msg)

    # Parse callsign for airline info
    callsign = msg.get("callsign")
    if callsign:
        airline_info = parse_callsign(callsign)
        enriched["airline"] = {
            "icao": airline_info.get("airline_icao"),
            "iata": airline_info.get("airline_iata"),
            "name": airline_info.get("airline_name"),
            "flight_number": airline_info.get("flight_number"),
        }
    else:
        enriched["airline"] = None

    # Decode label
    label = msg.get("label")
    if label:
        label_info = decode_label(label)
        enriched["label_info"] = {
            "name": label_info.get("name"),
            "description": label_info.get("description"),
        }
    else:
        enriched["label_info"] = None

    # Decode text content
    text = msg.get("text")
    libacars_data = msg.get("libacars")
    if text:
        decoded_text = decode_message_text(text, label, libacars_data)
        if decoded_text:
            enriched["decoded_text"] = decoded_text
            # Also add human-readable formatted version
            formatted = format_decoded_text(decoded_text)
            if formatted:
                enriched["formatted_text"] = formatted

    return enriched


def get_airline_from_callsign(callsign: str) -> tuple[str, str] | None:
    """
    Simple helper to get airline name from callsign.
    Returns (icao_code, airline_name) or None if not found.
    """
    if not callsign:
        return None

    info = parse_callsign(callsign)
    icao = info.get("airline_icao")
    name = info.get("airline_name")

    if icao and name:
        return (icao, name)
    return None
