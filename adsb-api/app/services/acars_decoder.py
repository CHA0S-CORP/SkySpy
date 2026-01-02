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


def decode_message_text(text: str, label: str = None) -> dict:
    """
    Attempt to decode the text content of an ACARS message.

    Different message types have different text formats:
    - Position reports may contain coordinates
    - OOOI messages contain timestamps
    - Weather messages contain METAR/TAF data

    Returns a dict with decoded fields based on message type.
    """
    if not text:
        return {}

    decoded = {}
    text = text.strip()

    # Try to extract common patterns

    # Departure/Destination airports (4-letter ICAO codes)
    airport_pattern = r'\b([A-Z]{4})\b'
    airports = re.findall(airport_pattern, text)
    if airports:
        # Filter out common non-airport matches
        valid_airports = [a for a in airports if not a.startswith(('ACMS', 'BITE', 'OOOI', 'CREW'))]
        if valid_airports:
            decoded["airports_mentioned"] = list(set(valid_airports))

    # Coordinates pattern (latitude/longitude)
    # Various formats: N4512.3W12345.6, +45.123/-123.456, etc.
    coord_pattern = r'([NS]?\d{2,4}[.\d]*[NS]?)\s*[/,]?\s*([EW]?\d{2,5}[.\d]*[EW]?)'
    coords = re.findall(coord_pattern, text)
    if coords:
        decoded["coordinates_found"] = True

    # Altitude pattern
    alt_pattern = r'\b(?:FL|F/L|ALT)\s*(\d{2,3})\b'
    alts = re.findall(alt_pattern, text, re.IGNORECASE)
    if alts:
        # Convert flight level to feet if 3 digits or less
        decoded["flight_levels"] = [int(a) * 100 if int(a) < 1000 else int(a) for a in alts]

    # Temperature
    temp_pattern = r'([+-]?\d{1,3})\s*[°]?[CF]\b'
    temps = re.findall(temp_pattern, text)
    if temps:
        decoded["temperatures"] = [int(t) for t in temps]

    # Wind pattern (e.g., "270/35" or "27035KT")
    wind_pattern = r'(\d{3})[/]?(\d{2,3})(?:KT|KTS)?\b'
    winds = re.findall(wind_pattern, text)
    if winds:
        decoded["winds"] = [{"direction": int(w[0]), "speed": int(w[1])} for w in winds]

    # OOOI times (Out, Off, On, In)
    if label == "80":
        # Look for time patterns (HHMM or HH:MM)
        time_pattern = r'\b(\d{2}):?(\d{2})\b'
        times = re.findall(time_pattern, text)
        if times:
            decoded["oooi_times"] = [f"{t[0]}:{t[1]}" for t in times[:4]]

    # Fuel values (typically in pounds or kg)
    fuel_pattern = r'\b(\d{4,6})\s*(?:LBS?|KGS?|#)?\b'
    if 'FUEL' in text.upper():
        fuels = re.findall(fuel_pattern, text)
        if fuels:
            decoded["fuel_values"] = [int(f) for f in fuels[:3]]

    return decoded


def enrich_acars_message(msg: dict) -> dict:
    """
    Enrich an ACARS message with decoded information.

    Takes a normalized ACARS message dict and adds:
    - airline: Airline information parsed from callsign
    - label_info: Decoded label information
    - decoded_text: Parsed text content (if applicable)

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
    if text:
        decoded_text = decode_message_text(text, label)
        if decoded_text:
            enriched["decoded_text"] = decoded_text

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
