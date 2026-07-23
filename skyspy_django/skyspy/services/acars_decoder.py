"""
ACARS message decoder and enrichment.
Parses callsigns to extract airline information and decodes message labels.

Uses libacars for complex message format decoding (FANS-1/A, CPDLC, MIAM, etc.)
when pre-decoded data isn't available from upstream sources.

Based on logic from:
https://github.com/sdr-enthusiasts/docker-acarshub/blob/main/rootfs/webapp/acarshub_helpers.py
"""

import logging
import re
from functools import lru_cache

from django.db import DatabaseError

from skyspy.services.libacars_binding import (
    is_available as libacars_is_available,
)

logger = logging.getLogger(__name__)


# Airline lookup tables (subset - full tables would be in data/airlines.py)
ICAO_TO_AIRLINE = {
    "AAL": ("AA", "American Airlines"),
    "DAL": ("DL", "Delta Air Lines"),
    "UAL": ("UA", "United Airlines"),
    "SWA": ("WN", "Southwest Airlines"),
    "JBU": ("B6", "JetBlue Airways"),
    "ASA": ("AS", "Alaska Airlines"),
    "FFT": ("F9", "Frontier Airlines"),
    "NKS": ("NK", "Spirit Airlines"),
    "AWE": ("US", "US Airways"),  # Merged with American
    "SKW": ("OO", "SkyWest Airlines"),
    "RPA": ("YX", "Republic Airways"),
    "ENY": ("MQ", "Envoy Air"),
    "PDT": ("PT", "Piedmont Airlines"),
    "EJA": ("EJA", "NetJets"),
    "BAW": ("BA", "British Airways"),
    "AFR": ("AF", "Air France"),
    "DLH": ("LH", "Lufthansa"),
    "KLM": ("KL", "KLM Royal Dutch Airlines"),
    "ACA": ("AC", "Air Canada"),
    "QFA": ("QF", "Qantas"),
    "SIA": ("SQ", "Singapore Airlines"),
    "UAE": ("EK", "Emirates"),
    "ETD": ("EY", "Etihad Airways"),
    "QTR": ("QR", "Qatar Airways"),
    "THY": ("TK", "Turkish Airlines"),
    "CPA": ("CX", "Cathay Pacific"),
    "JAL": ("JL", "Japan Airlines"),
    "ANA": ("NH", "All Nippon Airways"),
    "KAL": ("KE", "Korean Air"),
    "EVA": ("BR", "EVA Air"),
    "FDX": ("FX", "FedEx Express"),
    "UPS": ("5X", "UPS Airlines"),
    "GTI": ("GT", "Atlas Air"),
}

IATA_TO_AIRLINE = {v[0]: (k, v[1]) for k, v in ICAO_TO_AIRLINE.items()}


# Message label descriptions
MESSAGE_LABELS = {
    "10": {"name": "Out", "description": "Aircraft departed gate (OOOI)"},
    "11": {"name": "Off", "description": "Aircraft took off (OOOI)"},
    "12": {"name": "On", "description": "Aircraft landed (OOOI)"},
    "13": {"name": "In", "description": "Aircraft arrived at gate (OOOI)"},
    "15": {"name": "ETA", "description": "Estimated Time of Arrival"},
    "16": {"name": "Departure", "description": "Departure message"},
    "17": {"name": "Arrival", "description": "Arrival message"},
    "20": {"name": "Request", "description": "Operational request"},
    "21": {"name": "Advisory", "description": "Weather advisory"},
    "22": {"name": "Report", "description": "Periodic report"},
    "2P": {"name": "Progress", "description": "Flight progress"},
    "33": {"name": "ATIS", "description": "Automatic Terminal Info Service"},
    "44": {"name": "Weather", "description": "Weather request/data"},
    "80": {"name": "OOOI", "description": "Out/Off/On/In event"},
    "83": {"name": "Fuel", "description": "Fuel request/data"},
    "H1": {"name": "Datalink", "description": "HF datalink message"},
    "H2": {"name": "Datalink", "description": "HF datalink message"},
    "QA": {"name": "Weather", "description": "Weather request"},
    "QB": {"name": "Weather", "description": "Weather data"},
    "QC": {"name": "Weather", "description": "Weather info"},
    "QD": {"name": "Weather", "description": "Weather update"},
    "QE": {"name": "Weather", "description": "Weather query"},
    "QF": {"name": "Weather", "description": "Weather forecast"},
    "Q0": {"name": "Weather", "description": "Weather link"},
    "Q1": {"name": "Weather", "description": "Weather link"},
    "Q2": {"name": "Weather", "description": "Weather link"},
    "SA": {"name": "System", "description": "System message"},
    "SQ": {"name": "Squitter", "description": "Ground station ID"},
    "B9": {"name": "General", "description": "General communication"},
    "_d": {"name": "Demand", "description": "Demand mode message"},
    "5Z": {"name": "ACMS", "description": "Aircraft condition monitoring"},
}


def find_airline_by_icao(icao_code: str) -> tuple[str, str]:
    """
    Look up airline by ICAO code. Returns (iata_code, name) or (icao_code, 'Unknown Airline').

    First checks the cached database (from OpenFlights), then falls back to hardcoded dictionary.
    """
    # Try database lookup first (from OpenFlights data)
    try:
        from skyspy.services.openflights import get_airline_by_icao

        airline = get_airline_by_icao(icao_code)
        if airline:
            return (airline.get("iata_code") or icao_code, airline.get("name", "Unknown Airline"))
    except DatabaseError:
        pass  # Fall back to hardcoded dictionary

    # Fallback to hardcoded dictionary
    if icao_code in ICAO_TO_AIRLINE:
        return ICAO_TO_AIRLINE[icao_code]
    return (icao_code, "Unknown Airline")


def find_airline_by_iata(iata_code: str) -> tuple[str, str]:
    """
    Look up airline by IATA code. Returns (icao_code, name) or (iata_code, 'Unknown Airline').

    First checks the cached database (from OpenFlights), then falls back to hardcoded dictionary.
    """
    # Try database lookup first (from OpenFlights data)
    try:
        from skyspy.models.notams import CachedAirline

        airline = CachedAirline.objects.filter(iata_code__iexact=iata_code).first()
        if airline:
            return (airline.icao_code, airline.name)
    except DatabaseError:
        pass  # Fall back to hardcoded dictionary

    # Fallback to hardcoded dictionary
    if iata_code in IATA_TO_AIRLINE:
        return IATA_TO_AIRLINE[iata_code]
    return (iata_code, "Unknown Airline")


def lookup_label(label: str) -> dict | None:
    """Look up message label description."""
    return MESSAGE_LABELS.get(label)


def get_label_name(label: str) -> str:
    """Get human-readable label name."""
    info = lookup_label(label)
    return info.get("name") if info else label


@lru_cache(maxsize=1000)
def parse_callsign(callsign: str) -> dict:
    """
    Parse a flight callsign to extract airline information.

    Callsigns can be in two formats:
    - ICAO format: 3-letter airline code + flight number (e.g., "UAL123", "BAW456")
    - IATA format: 2-letter airline code + flight number (e.g., "UA123", "BA456")
    """
    if not callsign:
        return {
            "callsign": None,
            "airline_code": None,
            "airline_icao": None,
            "airline_iata": None,
            "airline_name": None,
            "flight_number": None,
            "format": "unknown",
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
            "format": "icao",
        }

    # Check if first 2 characters form a valid IATA code (must contain at least one letter)
    # IATA codes are 2 alphanumeric characters, but pure numeric codes like "12" are not valid airlines
    elif len(callsign) >= 2 and any(c.isalpha() for c in callsign[:2]):
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
            "format": "iata",
        }

    return {
        "callsign": callsign,
        "airline_code": None,
        "airline_icao": None,
        "airline_iata": None,
        "airline_name": None,
        "flight_number": None,
        "format": "unknown",
    }


def decode_label(label: str) -> dict:
    """Decode an ACARS message label to get its description."""
    if not label:
        return {"label": None, "name": None, "description": None}

    label = label.strip()
    info = lookup_label(label)

    if info:
        return {"label": label, "name": info.get("name"), "description": info.get("description")}

    return {"label": label, "name": None, "description": None}


def validate_coordinates(lat: float, lon: float) -> bool:
    """Validate that coordinates are within valid ranges."""
    return -90 <= lat <= 90 and -180 <= lon <= 180


def _finish_coord(lat: float, lon: float) -> dict | None:
    """Validate and round a lat/lon pair, or return None if out of range."""
    if validate_coordinates(lat, lon):
        return {"lat": round(lat, 4), "lon": round(lon, 4)}
    return None


def parse_coordinates(text: str) -> dict | None:
    """
    Parse coordinates from the several formats seen in real ACARS position
    reports (labels 16/17/20/21/22, ADS, OOOI). Spaces are stripped first, so
    lat/lon may be joined directly or separated by ``,`` or ``/``. Supported:

    - ``N3417.9W11645.4``   degrees + decimal minutes (DDMM.m)
    - ``N34.0145W108.9483`` decimal degrees, hemisphere prefix (any separator)
    - ``42.7921N78.6982W``  decimal degrees, hemisphere suffix
    - ``N12345W123456``     DDMMt packed (minutes in tenths) — legacy fallback
    """
    if not text:
        return None

    text_clean = text.replace(" ", "").replace("\n", "").replace("\r", "")

    # DDMM.m — 2/3-digit degrees followed by 2-digit minutes with a decimal.
    # Reject minutes >= 60 (a garbled value like 78.5 would add 1.3 spurious
    # degrees yet still pass the +/-90/180 range check) — fall through to the
    # other formats instead.
    m = re.search(r"([NS])(\d{2})(\d{2}\.\d+)[,/]?([EW])(\d{3})(\d{2}\.\d+)", text_clean)
    if m and float(m.group(3)) < 60 and float(m.group(6)) < 60:
        lat = int(m.group(2)) + float(m.group(3)) / 60
        lon = int(m.group(5)) + float(m.group(6)) / 60
        return _finish_coord(-lat if m.group(1) == "S" else lat, -lon if m.group(4) == "W" else lon)

    # Decimal degrees, hemisphere prefix: N34.0145 / W108.9483 (any separator).
    m = re.search(r"([NS])(\d{1,2}\.\d+)[,/]?([EW])(\d{1,3}\.\d+)", text_clean)
    if m:
        lat = float(m.group(2))
        lon = float(m.group(4))
        return _finish_coord(-lat if m.group(1) == "S" else lat, -lon if m.group(3) == "W" else lon)

    # Decimal degrees, hemisphere suffix: 42.7921N 78.6982W.
    m = re.search(r"(\d{1,2}\.\d+)([NS])[,/]?(\d{1,3}\.\d+)([EW])", text_clean)
    if m:
        lat = float(m.group(1))
        lon = float(m.group(3))
        return _finish_coord(-lat if m.group(2) == "S" else lat, -lon if m.group(4) == "W" else lon)

    # Legacy DDMMt packed form (minutes in tenths): N12345W123456.
    # Minutes-in-tenths must be < 600 (i.e. < 60 minutes) to be valid.
    m = re.search(r"([NS])(\d{2})(\d{3})([EW])(\d{3})(\d{3})", text_clean)
    if m and int(m.group(3)) < 600 and int(m.group(6)) < 600:
        lat = int(m.group(2)) + (int(m.group(3)) / 10) / 60
        lon = int(m.group(5)) + (int(m.group(6)) / 10) / 60
        return _finish_coord(-lat if m.group(1) == "S" else lat, -lon if m.group(4) == "W" else lon)

    return None


def decode_h1_message(text: str) -> dict | None:
    """Decode H1 (Datalink) message sub-types."""
    if not text:
        return None

    decoded = {}
    text_clean = text.replace("\n", "").replace("\r", "")

    # FPN - Flight Plan
    if "FPN/" in text_clean or re.match(r"^[A-Z0-9#]*FPN/", text_clean):
        decoded["message_type"] = "Flight Plan"
        decoded["description"] = "FPN flight plan/route data"

        da_match = re.search(r"DA:([A-Z]{4})", text_clean)
        aa_match = re.search(r"AA:([A-Z]{4})", text_clean)
        if da_match:
            decoded["origin"] = da_match.group(1)
        if aa_match:
            decoded["destination"] = aa_match.group(1)

        route_match = re.search(r"F:([A-Z0-9./]+)", text_clean)
        if route_match:
            route_str = route_match.group(1)
            waypoints = re.findall(r"([A-Z]{3,5})", route_str)
            if waypoints:
                decoded["route"] = " -> ".join(waypoints[:10])
                decoded["waypoints"] = waypoints[:10]

        return decoded

    # POS - Position Report
    if "/POS/" in text_clean or re.match(r"^[A-Z0-9#]*POS/", text_clean):
        decoded["message_type"] = "Position Report"
        decoded["description"] = "H1 position report"

        # Reuse parse_coordinates for position extraction
        coords = parse_coordinates(text_clean)
        if coords:
            decoded["position"] = coords

        alt_match = re.search(r"/A(\d{5})", text_clean)
        if alt_match:
            decoded["altitude_ft"] = int(alt_match.group(1))
            decoded["flight_level"] = f"FL{int(alt_match.group(1)) // 100}"

        return decoded

    # PRG - Progress Report
    if "PRG/" in text_clean:
        decoded["message_type"] = "Progress Report"
        decoded["description"] = "Flight progress update"

        prg_match = re.search(r"PRG/([A-Z0-9]+)/DT([A-Z]{4})", text_clean)
        if prg_match:
            decoded["progress_id"] = prg_match.group(1)
            decoded["destination"] = prg_match.group(2)

        return decoded

    return None


def decode_message_text(text: str, label: str = None, libacars_data: dict = None, direction: int = 0) -> dict:
    """
    Attempt to decode the text content of an ACARS message.

    Uses libacars for complex message formats when:
    - libacars_data is not provided from upstream
    - libacars library is available
    - Message label suggests decodable content (H1, SA, etc.)

    Args:
        text: Message text content
        label: ACARS message label
        libacars_data: Pre-decoded data from upstream (if available)
        direction: Message direction, matching MsgDir
            (0=unknown, 1=uplink/ground-to-air, 2=downlink/air-to-ground)

    Returns:
        Dictionary with decoded message fields
    """
    if not text:
        return {}

    decoded = {}
    text_stripped = text.strip()
    text_upper = text_stripped.upper()

    # Use pre-decoded libacars data if provided
    if libacars_data:
        decoded["libacars"] = libacars_data
    elif label and libacars_is_available():
        # Try to decode with libacars for complex message formats
        # Labels that commonly have decodable content
        decodable_labels = {
            "H1",
            "H2",  # FANS-1/A (ADS-C, CPDLC)
            "SA",
            "S1",
            "S2",  # System address messages
            "AA",
            "AB",
            "AC",  # ARINC 622 messages
            "BA",
            "B1",
            "B2",
            "B3",
            "B4",
            "B5",
            "B6",  # Various airline formats
            "_d",
            "2Z",
            "5Z",  # MIAM compressed messages
        }
        if label in decodable_labels:
            try:
                # Isolated in a subprocess: some malformed CPDLC/ARINC payloads
                # segfault libacars, which would otherwise kill the whole worker
                # (and stop the aircraft feed sharing it). See acars_safe_decode.
                from skyspy.services.acars_safe_decode import safe_decode_acars_apps

                result = safe_decode_acars_apps(label, text_stripped, direction)
                if result:
                    decoded["libacars"] = result
                    logger.debug("libacars_decoded", extra={"label": label, "keys": list(result.keys())})
            except Exception as e:  # broad: third-party libacars CFFI/ctypes decode, unknowable failure modes
                logger.debug("libacars_decode_failed", extra={"label": label, "error": str(e)})

    # Ground Station Squitter
    gs_pattern = r"^(\d{2})X([SA])([A-Z]{3})([A-Z]{4})(\d)(\d{4})([NS])(\d{5})([EW])V(\d{6})/?(.*)$"
    gs_match = re.match(gs_pattern, text_stripped.replace(" ", ""))
    if gs_match:
        gs_match.group(1)
        network_type = "SITA" if gs_match.group(2) == "S" else "ARINC"
        iata_code = gs_match.group(3)
        icao_code = gs_match.group(4)

        decoded["message_type"] = "Ground Station Squitter"
        decoded["description"] = "Ground station identification broadcast"
        decoded["ground_station"] = f"{icao_code}"
        decoded["iata"] = iata_code
        decoded["icao"] = icao_code
        decoded["network"] = network_type
        return decoded

    # H1 Messages
    if label == "H1":
        h1_decoded = decode_h1_message(text_stripped)
        if h1_decoded:
            decoded.update(h1_decoded)
            return decoded

    # Position / ADS reports (labels 16, 17, 20, 21, 22). These carry a lat/lon
    # in one of several formats (see parse_coordinates) plus, on some, a
    # requested/next fix ident. Only claim a position report if we extract
    # something geographic; otherwise fall through to generic parsing.
    if label in ("16", "17", "20", "21", "22"):
        pos_decoded = {}
        coords = parse_coordinates(text_stripped)
        if coords:
            pos_decoded["position"] = coords

        alt_match = re.search(r"(?:ALT|/A)?(\d{4,5})FT|ALT(\d{4,5})|FL(\d{2,3})", text_upper)
        if alt_match:
            if alt_match.group(3):  # FLxxx
                pos_decoded["altitude_ft"] = int(alt_match.group(3)) * 100
                pos_decoded["flight_level"] = f"FL{int(alt_match.group(3))}"
            else:
                # The bare-number+FT alternative can match non-altitude figures
                # (a "3400FT AGL" terrain note, a fuel value). Only accept a
                # plausible cruise/approach altitude so those don't get plotted.
                alt = int(alt_match.group(1) or alt_match.group(2))
                if 0 < alt <= 60000:
                    pos_decoded["altitude_ft"] = alt
                    pos_decoded["flight_level"] = f"FL{alt // 100}"

        # Requested / next waypoint ident (e.g. "REQ POS JAWBN", "NEXT WPT MARNR").
        wpt_match = re.search(r"(?:REQ\s*POS|NEXT\s*WPT|WPT|TO)\s+([A-Z]{3,5})\b", text_upper)
        if wpt_match:
            pos_decoded["waypoints"] = [wpt_match.group(1)]

        if pos_decoded:
            decoded["message_type"] = "Position Report"
            decoded["description"] = "Aircraft position/ADS report"
            decoded.update(pos_decoded)
            return decoded

    # OOOI Events
    oooi_labels = {"10": "Out", "11": "Off", "12": "On", "13": "In", "80": "OOOI"}
    if label in oooi_labels:
        decoded["message_type"] = "OOOI Event"
        decoded["event_type"] = oooi_labels[label]
        decoded["description"] = f"Flight phase: {oooi_labels[label]}"

        oooi_pos = re.search(r"([NS])\s*(\d+\.?\d*)\s*,\s*([EW])\s*(\d+\.?\d*)\s*,\s*(\d+)", text_stripped)
        if oooi_pos:
            lat = float(oooi_pos.group(2))
            if oooi_pos.group(1) == "S":
                lat = -lat
            lon = float(oooi_pos.group(4))
            if oooi_pos.group(3) == "W":
                lon = -lon
            altitude = int(oooi_pos.group(5))
            decoded["position"] = {"lat": lat, "lon": lon}
            decoded["altitude_ft"] = altitude

        return decoded

    # Weather labels
    if label in ("QA", "QB", "QC", "QD", "QE", "QF", "Q0", "Q1", "Q2"):
        decoded["message_type"] = "Weather"
        decoded["description"] = "Weather data request or report"
        if "METAR" in text_upper:
            decoded["weather_type"] = "METAR"
        elif "TAF" in text_upper:
            decoded["weather_type"] = "TAF"
        return decoded

    # Generic airport extraction - ICAO codes are 4 letters
    # Valid ICAO region prefixes (first letter determines region):
    # B: Iceland/Greenland, C: Canada, D: West Africa, E: Northern Europe,
    # F: Central/Southern Africa, G: West Africa, H: East Africa,
    # K: Continental USA, L: Southern Europe, M: Central America/Mexico/Caribbean,
    # N: South Pacific, O: Middle East, P: Pacific (Hawaii/Alaska/Guam),
    # R: Far East (Japan/Korea), S: South America, T: Caribbean,
    # U: Russia, V: South/Southeast Asia, W: Indonesia/Malaysia,
    # Y: Australia, Z: China/Mongolia
    # Note: 'A' and 'X' are NOT valid ICAO first-letter prefixes
    valid_icao_prefixes = set("BCDEFGHKLMNOPRSTUVWYZ")

    airport_pattern = r"\b([A-Z]{4})\b"
    airports = re.findall(airport_pattern, text_stripped)
    if airports:
        # Common 4-letter words to exclude (not airport codes)
        excluded_words = {
            "ACMS",
            "ATIS",
            "AUTO",
            "BANK",
            "CITY",
            "CODE",
            "DATA",
            "DATE",
            "DOOR",
            "DOWN",
            "EAST",
            "ECHO",
            "EDIT",
            "FAIL",
            "FILE",
            "FIRE",
            "FLED",
            "FLEX",
            "FLOW",
            "FUEL",
            "FULL",
            "GATE",
            "GEAR",
            "GOOD",
            "HALF",
            "HAVE",
            "HEAD",
            "HEAT",
            "HIGH",
            "HOLD",
            "HOME",
            "INFO",
            "ITEM",
            "LAND",
            "LATE",
            "LEFT",
            "LINE",
            "LINK",
            "LIST",
            "LOAD",
            "LONG",
            "LOST",
            "MAIN",
            "MAKE",
            "MARK",
            "MENU",
            "MODE",
            "MORE",
            "MOVE",
            "MUST",
            "NAME",
            "NEXT",
            "NONE",
            "NORM",
            "NOTE",
            "ONLY",
            "OPEN",
            "OVER",
            "PAGE",
            "PART",
            "PASS",
            "PATH",
            "PLAN",
            "PLAY",
            "PORT",
            "PULL",
            "PUSH",
            "RATE",
            "READ",
            "REPT",
            "ROLE",
            "ROOM",
            "SAFE",
            "SAME",
            "SAVE",
            "SEAL",
            "SEAT",
            "SELF",
            "SEND",
            "SHOW",
            "SHUT",
            "SIDE",
            "SIGN",
            "SIZE",
            "SLOW",
            "SOME",
            "STOP",
            "TAKE",
            "TAXI",
            "TEST",
            "TEXT",
            "THAT",
            "THEM",
            "THEN",
            "THIS",
            "TIME",
            "TURN",
            "TYPE",
            "UNIT",
            "UPON",
            "USED",
            "USER",
            "VIEW",
            "VOID",
            "WAIT",
            "WARM",
            "WARN",
            "WEST",
            "WHEN",
            "WITH",
            "WORK",
            "ZONE",
            "FROM",
            "METAR",
            "PROG",
            "VERY",
            "ACARS",
            "FANS",
            "CPDLC",
        }
        # Filter: must start with valid ICAO prefix AND not be an excluded word
        valid_airports = [a for a in airports if a[0] in valid_icao_prefixes and a not in excluded_words]
        if valid_airports:
            decoded["airports_mentioned"] = list(set(valid_airports))[:5]

    return decoded


def enrich_acars_message(msg: dict, *, decode_text: bool = False) -> dict:
    """
    Enrich an ACARS message with decoded information.

    Args:
        msg: Raw ACARS message dict
        decode_text: If True, decode message text with libacars (CPU-intensive).
                     Set to False for fast ingestion (decoding done via Celery).

    Returns:
        Enriched message dict with airline and label info, optionally decoded text.
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

    # Decode text content (optional - can be deferred to Celery)
    if decode_text:
        text = msg.get("text")
        libacars_data = msg.get("libacars")
        if text:
            decoded_text = decode_message_text(text, label, libacars_data, infer_acars_direction(msg))
            if decoded_text:
                enriched["decoded_text"] = decoded_text

    return enriched


def infer_acars_direction(msg: dict) -> int:
    """Infer ACARS message direction, matching libacars MsgDir.

    Returns 1 = GND2AIR/uplink, 2 = AIR2GND/downlink, 0 = unknown.

    Prefers an explicit ``direction`` field, then the block-id convention (an
    ACARS downlink block id is a digit, an uplink block id is a letter). The old
    code keyed on ``fromaddr``/``toaddr``, which the normalize pipeline never
    sets, so direction was always 0 (unknown) — the crash-prone CPDLC/ADS-C
    path. Passing a concrete direction when we can tell also steers away from
    that unknown-direction branch.
    """
    explicit = msg.get("direction")
    if explicit in (1, 2):
        return explicit
    block_id = str(msg.get("block_id") or "").strip()
    if len(block_id) == 1:
        if block_id.isdigit():
            return 2  # downlink (air-to-ground)
        if block_id.isalpha():
            return 1  # uplink (ground-to-air)
    return 0
