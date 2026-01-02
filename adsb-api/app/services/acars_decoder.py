"""
ACARS message decoder and enrichment.
Parses callsigns to extract airline information and decodes message labels.

Based on logic from:
https://github.com/sdr-enthusiasts/docker-acarshub/blob/main/rootfs/webapp/acarshub_helpers.py
"""
import re
import logging
from typing import Optional

from app.data.airlines import find_airline_by_iata, find_airline_by_icao
from app.data.message_labels import lookup_label, get_label_name

logger = logging.getLogger(__name__)


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
        lat_deg = int(gs_match.group(6)[:2])
        lat_min = int(gs_match.group(6)[2:]) / 100
        lat_dir = gs_match.group(7)
        lon_deg = int(gs_match.group(8)[:3])
        lon_min = int(gs_match.group(8)[3:]) / 100
        lon_dir = gs_match.group(9)
        freq = int(gs_match.group(10)) / 1000  # Convert to MHz
        extra = gs_match.group(11)

        lat = lat_deg + lat_min / 60
        if lat_dir == 'S':
            lat = -lat
        lon = lon_deg + lon_min / 60
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

    # ========== Pre-Departure Clearance (Label H1) ==========
    if label == "H1":
        decoded["message_type"] = "Pre-Departure Clearance"
        decoded["description"] = "PDC/DCL departure clearance data"

        # Try to find routing info - format: REQPWI/WQ370:PETLI/DQ370/SPC85A
        route_match = re.search(r'([A-Z]{3,6})/([A-Z]{2}\d+):([A-Z0-9/:]+)', text_stripped)
        if route_match:
            decoded["request_type"] = route_match.group(1)
            decoded["flight_id"] = route_match.group(2)
            decoded["route"] = route_match.group(3)

        # Format: PRG/FMWJA120/DTCYYC,17L,94,043427,3056B5
        prg_match = re.search(r'PRG/([A-Z0-9]+)/DT([A-Z]{4}),([^,]+),(\d+),(\d+),([A-Z0-9]+)', text_stripped)
        if prg_match:
            decoded["progress_id"] = prg_match.group(1)
            decoded["destination"] = prg_match.group(2)
            decoded["runway"] = prg_match.group(3)
            decoded["sequence"] = prg_match.group(4)

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
    # Only format if we have a message_type or significant decoded fields
    has_meaningful_data = (
        decoded.get("message_type") or
        decoded.get("ground_station") or
        decoded.get("position") or
        decoded.get("location") or
        decoded.get("destination") or
        decoded.get("route")
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

    # PDC/Clearance info
    if decoded.get("destination"):
        lines.append(f"Destination: {decoded['destination']}")
    if decoded.get("runway"):
        lines.append(f"Runway: {decoded['runway']}")
    if decoded.get("request_type"):
        lines.append(f"Request: {decoded['request_type']}")
    if decoded.get("flight_id"):
        lines.append(f"Flight ID: {decoded['flight_id']}")

    # Route info
    if decoded.get("route"):
        lines.append(f"Route: {decoded['route']}")
    if decoded.get("waypoints"):
        lines.append(f"Waypoints: {', '.join(decoded['waypoints'][:5])}")

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
