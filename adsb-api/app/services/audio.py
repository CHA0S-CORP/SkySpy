"""
Audio transmission service for rtl-airband radio.

Handles:
- Receiving audio uploads from rtl-airband
- Uploading to S3
- Queueing transcription jobs
- Identifying airframes from transcripts
"""
import asyncio
import io
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AudioTransmission

logger = logging.getLogger(__name__)
settings = get_settings()

# S3 client (lazy initialized)
_s3_client = None

# Transcription queue
_transcription_queue: asyncio.Queue = None

# Semaphore to limit concurrent Whisper transcriptions (resource-intensive)
_whisper_semaphore: asyncio.Semaphore = None

# Statistics
_stats = {
    "uploads": 0,
    "upload_errors": 0,
    "transcriptions_queued": 0,
    "transcriptions_completed": 0,
    "transcriptions_failed": 0,
}

# Common airline callsign prefixes (ICAO 3-letter codes mapped to airline names)
AIRLINE_CALLSIGNS = {
    "AAL": "American Airlines",
    "UAL": "United Airlines",
    "DAL": "Delta Air Lines",
    "SWA": "Southwest Airlines",
    "JBU": "JetBlue Airways",
    "ASA": "Alaska Airlines",
    "FFT": "Frontier Airlines",
    "NKS": "Spirit Airlines",
    "SKW": "SkyWest Airlines",
    "ENY": "Envoy Air",
    "RPA": "Republic Airways",
    "PDT": "Piedmont Airlines",
    "JIA": "PSA Airlines",
    "AWI": "Air Wisconsin",
    "FDX": "FedEx Express",
    "UPS": "UPS Airlines",
    "GTI": "Atlas Air",
    "BAW": "British Airways",
    "AFR": "Air France",
    "DLH": "Lufthansa",
    "KLM": "KLM Royal Dutch",
    "ACA": "Air Canada",
    "QFA": "Qantas",
    "UAE": "Emirates",
    "SIA": "Singapore Airlines",
    "CPA": "Cathay Pacific",
    "ANA": "All Nippon Airways",
    "JAL": "Japan Airlines",
    "THY": "Turkish Airlines",
    "QTR": "Qatar Airways",
    "ETD": "Etihad Airways",
    "EIN": "Aer Lingus",
    "RYR": "Ryanair",
    "EZY": "easyJet",
    "VIR": "Virgin Atlantic",
    "WJA": "WestJet",
    "AZA": "Alitalia",
    "IBE": "Iberia",
    "TAP": "TAP Portugal",
    "SAS": "Scandinavian Airlines",
    "FIN": "Finnair",
    "LOT": "LOT Polish",
    "CSN": "China Southern",
    "CES": "China Eastern",
    "CCA": "Air China",
    "EVA": "EVA Air",
    "KAL": "Korean Air",
    "AAR": "Asiana Airlines",
}

# Phonetic alphabet for number parsing (includes common misheard variants)
PHONETIC_NUMBERS = {
    # Standard
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    # Aviation variants (ICAO standard pronunciation)
    "niner": "9", "fife": "5", "tree": "3", "fower": "4",
    # Common transcription errors / homophones
    "won": "1", "to": "2", "too": "2", "for": "4", "fore": "4",
    "ate": "8", "won't": "1", "free": "3", "wan": "1",
    # Spelled out / shorthand
    "oh": "0", "o": "0", "nil": "0", "naught": "0",
    # ATC shortspeak - combined numbers often spoken as words
    "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
    "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70",
    "eighty": "80", "ninety": "90", "hundred": "00",
    # Slurred/fast speech transcription errors
    "wun": "1", "too-er": "2", "fo": "4", "fower": "4", "fi": "5",
    "sicks": "6", "ait": "8", "nein": "9",
}

# Phonetic alphabet letters (for N-numbers like "November Alpha Bravo 123")
PHONETIC_LETTERS = {
    # Standard ICAO
    "alpha": "A", "alfa": "A", "bravo": "B", "charlie": "C", "delta": "D",
    "echo": "E", "foxtrot": "F", "golf": "G", "hotel": "H", "india": "I",
    "juliet": "J", "juliett": "J", "kilo": "K", "lima": "L", "mike": "M",
    "november": "N", "oscar": "O", "papa": "P", "quebec": "Q", "romeo": "R",
    "sierra": "S", "tango": "T", "uniform": "U", "victor": "V", "whiskey": "W",
    "xray": "X", "x-ray": "X", "yankee": "Y", "zulu": "Z",
    # Common mishearings / transcription errors
    "alfa": "A", "al": "A", "brah": "B", "char": "C", "del": "D",
    "eck": "E", "fox": "F", "gulf": "G", "hoe": "H", "ind": "I",
    "jewel": "J", "key": "K", "lee": "L", "my": "M", "nov": "N",
    "oss": "O", "pop": "P", "beck": "Q", "row": "R", "see": "S",
    "tang": "T", "uni": "U", "vic": "V", "whis": "W", "ex": "X",
    "yank": "Y", "zoo": "Z",
}

# ATC phrases that might precede or contain callsigns
ATC_CONTEXT_PHRASES = [
    "CLEARED", "CONTACT", "RUNWAY", "TAXI", "HOLD", "TURN", "CLIMB", "DESCEND",
    "MAINTAIN", "TRAFFIC", "ROGER", "WILCO", "AFFIRMATIVE", "NEGATIVE",
    "DEPARTURE", "APPROACH", "TOWER", "GROUND", "CENTER", "RADAR",
    "SQUAWK", "IDENT", "ALTIMETER", "FLIGHT LEVEL", "HEADING", "DIRECT",
    "EXPECT", "REPORT", "POSITION", "INBOUND", "OUTBOUND", "FINAL",
    "BASE", "DOWNWIND", "CROSSWIND", "PATTERN", "CIRCUIT", "GO AROUND",
    "MISSED APPROACH", "HOLDING", "VECTORS", "ILS", "VOR", "GPS",
    "VISUAL", "CLEARED TO LAND", "LINE UP AND WAIT", "POSITION AND HOLD",
    "BEHIND", "FOLLOW", "CAUTION", "WAKE TURBULENCE", "TRAFFIC IN SIGHT",
]

# Airline name variants and common misspellings/mishearings
AIRLINE_VARIANTS = {
    # US Majors - full names, radio callsigns, and shortspeak
    "UNITED": "UAL", "UNITE": "UAL", "YOU KNIGHTED": "UAL", "UNIDED": "UAL",
    "AMERICAN": "AAL", "AMERIKIN": "AAL", "AMERCAN": "AAL",
    "DELTA": "DAL", "DELDA": "DAL",
    "SOUTHWEST": "SWA", "SOUTH WEST": "SWA", "SOUTHWEST AIRLINES": "SWA",
    "JETBLUE": "JBU", "JET BLUE": "JBU", "JETBLEW": "JBU", "BLUE": "JBU",
    "ALASKA": "ASA", "ALASKAN": "ASA",
    "FRONTIER": "FFT", "FRONTEER": "FFT",
    "SPIRIT": "NKS", "SPIRITS": "NKS",
    "HAWAIIAN": "HAL", "HAWAI'IAN": "HAL",
    "SUN COUNTRY": "SCX", "SUNCOUNTRY": "SCX",
    # Regionals
    "SKYWEST": "SKW", "SKY WEST": "SKW",
    "ENVOY": "ENY",
    "REPUBLIC": "RPA",
    "PIEDMONT": "PDT",
    "PSA": "JIA",
    "COMPASS": "CPZ",
    "ENDEAVOR": "EDV", "ENDEAVOUR": "EDV",
    "MESA": "ASH", "AIR SHUTTLE": "ASH",
    "HORIZON": "QXE",
    "EXPRESSJET": "ASQ", "EXPRESS JET": "ASQ",
    "COMMUTAIR": "UCA",
    "GOJET": "GJS", "GO JET": "GJS",
    # Cargo - radio callsigns are key here
    "FEDEX": "FDX", "FED EX": "FDX", "FEDERAL EXPRESS": "FDX", "FEDERAL": "FDX",
    "UPS": "UPS", "U P S": "UPS",
    "ATLAS": "GTI", "GIANT": "GTI",  # Atlas Air radio callsign is "Giant"
    "KALITTA": "CKS", "CONNIE": "CKS",  # Kalitta radio callsign
    "POLAR": "PAC", "POLAR AIR": "PAC",
    "CARGOLUX": "CLX",
    "SOUTHERN AIR": "SOO",
    "ABX": "ABX", "ABX AIR": "ABX",
    "WORLD": "WOA", "WORLD AIRWAYS": "WOA",
    # International - Radio callsigns (these are critical for ATC)
    "SPEEDBIRD": "BAW", "SPEED BIRD": "BAW",  # British Airways
    "SHAMROCK": "EIN", "SHAM ROCK": "EIN",    # Aer Lingus
    "SPRINGBOK": "SAA", "SPRING BOK": "SAA",  # South African
    "CLIPPER": "PAA",                          # Pan Am (historic)
    "CACTUS": "AWE",                           # America West / US Airways
    "CITRUS": "JBU",                           # JetBlue alternate
    "BRICKYARD": "AAL",                        # American alternate
    "DYNASTY": "CAL",                          # China Airlines
    "MAPLE": "ACA",                            # Air Canada alternate
    # International carriers - names and callsigns
    "BRITISH": "BAW", "BRITISH AIRWAYS": "BAW",
    "AIR FRANCE": "AFR", "AIRFRANCE": "AFR", "AIRFRANS": "AFR",
    "LUFTHANSA": "DLH", "LUFTANSA": "DLH", "LUFT": "DLH",
    "KLM": "KLM", "K L M": "KLM", "ROYAL DUTCH": "KLM",
    "AIR CANADA": "ACA", "AIRCANADA": "ACA", "CANAIR": "ACA",
    "QANTAS": "QFA", "QUANTAS": "QFA",
    "EMIRATES": "UAE", "EMIRATE": "UAE",
    "SINGAPORE": "SIA", "SINGAPORE AIRLINES": "SIA",
    "CATHAY": "CPA", "CATHAY PACIFIC": "CPA",
    "VIRGIN": "VIR", "VIRGIN ATLANTIC": "VIR",
    "RYANAIR": "RYR", "RYAN AIR": "RYR", "RYAN": "RYR",
    "EASYJET": "EZY", "EASY JET": "EZY", "EASY": "EZY",
    "TURKISH": "THY", "TURKISH AIRLINES": "THY",
    "QATAR": "QTR", "CUTTER": "QTR", "QATARI": "QTR",
    "ETIHAD": "ETD",
    "JAPAN": "JAL", "JAPAN AIR": "JAL", "JAPAN AIRLINES": "JAL",
    "KOREAN": "KAL", "KOREAN AIR": "KAL",
    "AIR CHINA": "CCA", "AIRCHINA": "CCA",
    "CHINA SOUTHERN": "CSN",
    "CHINA EASTERN": "CES",
    "EVA": "EVA", "EVA AIR": "EVA",
    "ANA": "ANA", "ALL NIPPON": "ANA",
    # European carriers
    "IBERIA": "IBE",
    "AEROMEXICO": "AMX", "AERO MEXICO": "AMX",
    "SWISS": "SWR", "SWISSAIR": "SWR",
    "AUSTRIAN": "AUA", "AUSTRIAN AIRLINES": "AUA",
    "BRUSSELS": "BEL", "BRUSSELS AIRLINES": "BEL",
    "SCANDINAVIAN": "SAS", "SAS": "SAS",
    "FINNAIR": "FIN", "FINN": "FIN",
    "LOT": "LOT", "LOT POLISH": "LOT",
    "ALITALIA": "AZA",
    "TAP": "TAP", "TAP PORTUGAL": "TAP",
    "ICELANDAIR": "ICE", "ICELAND": "ICE",
    "NORWEGIAN": "NAX", "NORSHUTTLE": "NAX",
    "WIZZ": "WZZ", "WIZZAIR": "WZZ", "WIZZ AIR": "WZZ",
    "VUELING": "VLG",
    # Middle East / Africa
    "SAUDIA": "SVA", "SAUDI": "SVA", "SAUDI ARABIAN": "SVA",
    "ROYAL AIR MAROC": "RAM", "MOROCCO": "RAM",
    "EGYPTAIR": "MSR", "EGYPT AIR": "MSR", "EGYPT": "MSR",
    "ETHIOPIAN": "ETH", "ETHIOPIAN AIRLINES": "ETH",
    "KENYA": "KQA", "KENYA AIRWAYS": "KQA",
    # Asia Pacific
    "ASIANA": "AAR",
    "GARUDA": "GIA", "GARUDA INDONESIA": "GIA",
    "THAI": "THA", "THAI AIRWAYS": "THA",
    "VIETNAM": "HVN", "VIETNAM AIRLINES": "HVN",
    "PHILIPPINE": "PAL", "PHILIPPINE AIRLINES": "PAL",
    "CEBU": "CEB", "CEBU PACIFIC": "CEB",
    "AIR INDIA": "AIC", "AIRINDIA": "AIC",
    "INDIGO": "IGO",
    "SCOOT": "TGW",
    "JETSTAR": "JST",
    "AIRASIA": "AXM", "AIR ASIA": "AXM",
    # Latin America
    "AVIANCA": "AVA",
    "LATAM": "LAN", "LAN CHILE": "LAN",
    "GOL": "GLO",
    "AZUL": "AZU",
    "COPA": "CMP", "COPA AIRLINES": "CMP",
    "VOLARIS": "VOI",
    "INTERJET": "AIJ",
}

# Common ATC shorthand / abbreviations that may appear in transcripts
ATC_ABBREVIATIONS = {
    # Speed
    "KNOTS": None,  # Marker only, no conversion
    "MACH": None,
    # Altitude references
    "FLIGHT LEVEL": "FL",
    "ANGELS": "ALT",  # Military - altitude in thousands
    "CHERUBS": "ALT",  # Military - altitude in hundreds
    # Directions
    "LEFT": "L", "RIGHT": "R",
    # Common instructions (not callsigns but context)
    "EXPEDITE": None, "IMMEDIATE": None, "EMERGENCY": None,
    "MAYDAY": None, "PAN PAN": None, "PANPAN": None,
}


def _convert_phonetic_to_digits(text: str) -> str:
    """
    Convert phonetic numbers in text to digits.
    Handles ATC shortspeak like:
    - "one two three" -> "123"
    - "niner five" -> "95"
    - "twenty three" -> "23"
    - "fifteen thirty four" -> "1534" (flight number style)
    - "one hundred twenty three" -> "123"
    """
    words = text.lower().split()
    result = []

    i = 0
    while i < len(words):
        # Strip punctuation
        clean_word = re.sub(r'[^\w\-]', '', words[i])

        # Handle hyphenated words like "too-er"
        clean_word = clean_word.replace('-', '')

        if clean_word in PHONETIC_NUMBERS:
            val = PHONETIC_NUMBERS[clean_word]
            # Handle "hundred" specially - "one hundred" = 100, not 100
            if clean_word == "hundred" and result:
                # Multiply previous digit by 100
                if len(result) == 1 and result[0] in "123456789":
                    result[-1] = result[-1] + "00"
                else:
                    result.append(val)
            else:
                result.append(val)
            i += 1
        elif clean_word.isdigit():
            result.append(clean_word)
            i += 1
        else:
            # Check for two-word numbers like "twenty one"
            if i + 1 < len(words):
                two_word = clean_word + " " + re.sub(r'[^\w]', '', words[i + 1].lower())
                # Skip two-word combinations that don't make sense
            # If we hit a non-number word after collecting digits, stop
            if result:
                break
            i += 1

    return ''.join(result)


def _normalize_flight_number(text: str) -> Optional[str]:
    """
    Extract and normalize a flight number from text.
    Handles ATC shortspeak:
    - "123" -> "123"
    - "one two three" -> "123"
    - "1 2 3" -> "123"
    - "twenty three" -> "23"
    - "fifteen thirty four" -> "1534"
    - "one thousand two hundred thirty four" -> "1234"
    """
    # First try direct digits (most common case)
    digit_match = re.search(r'\d{1,4}', text)
    if digit_match:
        return digit_match.group()

    # Try phonetic conversion for spoken numbers
    converted = _convert_phonetic_to_digits(text)
    if converted and len(converted) <= 4:
        return converted

    # Handle spaced digits like "1 2 3"
    spaced_digits = re.findall(r'\b(\d)\b', text)
    if spaced_digits and len(spaced_digits) <= 4:
        return ''.join(spaced_digits)

    return None


def _preprocess_transcript(text: str) -> str:
    """
    Preprocess transcript to normalize common ATC speech patterns.
    This helps with matching by standardizing variations.
    """
    # Normalize whitespace
    text = ' '.join(text.split())

    # Common contractions and speech patterns
    replacements = [
        # Readback confirmations often have these
        (r'\bROGER\s+THAT\b', 'ROGER'),
        (r'\bCOPY\s+THAT\b', 'ROGER'),
        (r'\bWILCO\b', ''),  # "Will comply" - not a callsign

        # Strip filler words that Whisper might transcribe
        (r'\bUH+\b', ''),
        (r'\bUM+\b', ''),
        (r'\bAH+\b', ''),

        # Normalize "flight" which sometimes precedes flight numbers
        (r'\bFLIGHT\s+', ''),

        # "Heavy" and "Super" standardization
        (r'\bHEAVY\s+HEAVY\b', 'HEAVY'),
        (r'\bSUPER\s+HEAVY\b', 'SUPER'),

        # Common phrase cleanup
        (r'\bGOOD\s+DAY\b', ''),
        (r'\bGOOD\s+MORNING\b', ''),
        (r'\bGOOD\s+AFTERNOON\b', ''),
        (r'\bGOOD\s+EVENING\b', ''),
    ]

    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    return text.strip()


def _fuzzy_match_airline(word: str) -> Optional[tuple[str, str]]:
    """
    Fuzzy match an airline name, returning (matched_name, icao_code) or None.
    Uses edit distance for approximate matching.
    """
    word_upper = word.upper().strip()

    # Exact match first
    if word_upper in AIRLINE_VARIANTS:
        return (word_upper, AIRLINE_VARIANTS[word_upper])

    # Try with common transcription artifacts removed
    cleaned = re.sub(r"['\-]", "", word_upper)
    if cleaned in AIRLINE_VARIANTS:
        return (cleaned, AIRLINE_VARIANTS[cleaned])

    # Simple fuzzy matching - check if word is close to any known airline
    # Allow 1-2 character differences for longer words
    for airline, icao in AIRLINE_VARIANTS.items():
        if len(airline) < 4:
            continue  # Skip short codes for fuzzy matching

        # Calculate simple edit distance (Levenshtein-like)
        if len(word_upper) >= len(airline) - 2 and len(word_upper) <= len(airline) + 2:
            distance = _levenshtein_distance(word_upper, airline)
            max_distance = 1 if len(airline) <= 6 else 2

            if distance <= max_distance:
                return (airline, icao)

    return None


def _levenshtein_distance(s1: str, s2: str) -> int:
    """Calculate the Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return _levenshtein_distance(s2, s1)

    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def extract_callsigns_from_transcript(transcript: str) -> list[dict]:
    """
    Extract aviation callsigns from a transcript with fuzzy matching.

    Handles imperfect transcriptions including:
    - Phonetic numbers: "United one two three" -> UAL123
    - ATC shortspeak: "Delta twenty three" -> DAL23
    - Misspellings: "Delda 456" -> DAL456
    - Radio callsigns: "Speedbird 123", "Giant 456" -> BAW123, GTI456
    - N-numbers with phonetics: "November one two three alpha bravo"
    - Heavy/super suffixes for wake turbulence category
    - Last 3 of tail: "Cessna three alpha bravo" -> N*3AB (partial)

    Returns:
        List of dicts with callsign info and confidence scores
    """
    if not transcript:
        return []

    callsigns = []
    seen = set()  # Avoid duplicates

    # Preprocess to normalize common ATC patterns
    text = _preprocess_transcript(transcript).upper()

    # === Pattern 1: Airline name + flight number (numeric or phonetic) ===
    # Build regex for all known airline names
    airline_names = '|'.join(re.escape(name) for name in AIRLINE_VARIANTS.keys())

    # Match airline followed by numbers or phonetic numbers
    # E.g., "UNITED 123", "DELTA ONE TWO THREE", "SPEEDBIRD NINER FIVE"
    phonetic_num_words = '|'.join(PHONETIC_NUMBERS.keys())
    airline_pattern = rf'\b({airline_names})\s+((?:\d+|(?:{phonetic_num_words})\s*)+)\s*(HEAVY|SUPER)?'

    for match in re.finditer(airline_pattern, text, re.IGNORECASE):
        airline_raw = match.group(1).upper()
        number_part = match.group(2)
        suffix = match.group(3) or ""

        icao = AIRLINE_VARIANTS.get(airline_raw)
        if not icao:
            continue

        # Convert phonetic numbers if present
        flight_num = _normalize_flight_number(number_part)
        if not flight_num or len(flight_num) > 4:
            continue

        callsign = f"{icao}{flight_num}"
        if callsign not in seen:
            seen.add(callsign)
            callsigns.append({
                "callsign": callsign,
                "raw": match.group(0).strip(),
                "type": "airline",
                "airline_icao": icao,
                "airline_name": AIRLINE_CALLSIGNS.get(icao),
                "flight_number": flight_num,
                "suffix": suffix.lower() if suffix else None,
                "confidence": 0.9 if number_part.strip().isdigit() else 0.7,
            })

    # === Pattern 2: Fuzzy airline matching for words not caught above ===
    # Split into potential airline + number sequences
    words = re.split(r'\s+', text)
    i = 0
    while i < len(words):
        word = words[i]
        match_result = _fuzzy_match_airline(word)

        if match_result:
            matched_name, icao = match_result

            # Look ahead for flight number
            number_parts = []
            j = i + 1
            while j < len(words) and j < i + 6:  # Look up to 5 words ahead
                next_word = words[j].lower()
                clean_word = re.sub(r'[^\w]', '', next_word)

                if clean_word.isdigit():
                    number_parts.append(clean_word)
                    j += 1
                elif clean_word in PHONETIC_NUMBERS:
                    number_parts.append(PHONETIC_NUMBERS[clean_word])
                    j += 1
                elif clean_word in ('heavy', 'super'):
                    break  # Stop at suffix
                else:
                    break

            if number_parts:
                flight_num = ''.join(number_parts)[:4]  # Max 4 digits
                callsign = f"{icao}{flight_num}"

                if callsign not in seen:
                    seen.add(callsign)
                    raw_text = ' '.join(words[i:j])

                    # Check for suffix
                    suffix = None
                    if j < len(words) and words[j].upper() in ('HEAVY', 'SUPER'):
                        suffix = words[j].lower()
                        raw_text += ' ' + words[j]

                    callsigns.append({
                        "callsign": callsign,
                        "raw": raw_text,
                        "type": "airline",
                        "airline_icao": icao,
                        "airline_name": AIRLINE_CALLSIGNS.get(icao),
                        "flight_number": flight_num,
                        "suffix": suffix,
                        "confidence": 0.6,  # Lower confidence for fuzzy match
                    })
                    i = j
                    continue
        i += 1

    # === Pattern 3: N-numbers (general aviation) ===
    # Handle: "N12345", "November 12345", "November one two three alpha bravo"
    # N-numbers format: N + 1-5 digits + 0-2 letters

    # Direct N-number pattern
    n_direct_pattern = r'\bN(\d{1,5})([A-Z]{0,2})\b'
    for match in re.finditer(n_direct_pattern, text):
        n_num = f"N{match.group(1)}{match.group(2)}"
        if len(n_num) >= 4 and n_num not in seen:
            seen.add(n_num)
            callsigns.append({
                "callsign": n_num,
                "raw": match.group(0).strip(),
                "type": "general_aviation",
                "confidence": 0.95,
            })

    # November + phonetic/numbers pattern
    november_pattern = r'\bNOVEMBER\s+(.+?)(?=\s+(?:CLEARED|CONTACT|RUNWAY|TAXI|HOLD|TURN|CLIMB|DESCEND|MAINTAIN|TRAFFIC|ROGER|WILCO|AFFIRMATIVE)|[,.]|$)'
    for match in re.finditer(november_pattern, text, re.IGNORECASE):
        tail_part = match.group(1).strip()

        # Parse the tail number
        digits = []
        letters = []
        parsing_letters = False

        for word in tail_part.split():
            word_lower = word.lower()
            word_clean = re.sub(r'[^\w]', '', word_lower)

            if word_clean.isdigit():
                if not parsing_letters:
                    digits.append(word_clean)
            elif word_clean in PHONETIC_NUMBERS:
                if not parsing_letters:
                    digits.append(PHONETIC_NUMBERS[word_clean])
            elif word_clean in PHONETIC_LETTERS:
                parsing_letters = True
                letters.append(PHONETIC_LETTERS[word_clean])
            elif len(word_clean) == 1 and word_clean.isalpha():
                parsing_letters = True
                letters.append(word_clean.upper())
            else:
                break  # Unknown word, stop parsing

        if digits:
            n_num = "N" + ''.join(digits)[:5] + ''.join(letters)[:2]
            if len(n_num) >= 4 and n_num not in seen:
                seen.add(n_num)
                callsigns.append({
                    "callsign": n_num,
                    "raw": match.group(0).strip(),
                    "type": "general_aviation",
                    "confidence": 0.75,
                })

    # === Pattern 4: Military and government callsigns ===
    # These use specific radio callsigns that are well-known
    military_patterns = [
        # Presidential / VIP
        (r'\bAIR\s*FORCE\s*(ONE|TWO|(?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'AIRFORCE'),
        (r'\bEXECUTIVE\s*(ONE|(?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'EXEC'),
        (r'\bSAM\s*(\d+|(?:' + phonetic_num_words + r')\s*)+', 'SAM'),  # Special Air Mission
        # Military branches
        (r'\bNAVY\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'NAVY'),
        (r'\bARMY\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'ARMY'),
        (r'\bMARINE\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'MARINE'),
        # Military transport/tanker callsigns
        (r'\bREACH\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'REACH'),  # AMC airlift
        (r'\bEVAC\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'EVAC'),   # Aeromedical
        (r'\bKING\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'KING'),   # HC-130 rescue
        (r'\bPEDRO\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'PEDRO'), # HH-60 rescue
        (r'\bJOLLY\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'JOLLY'), # HH-60 rescue
        (r'\bSHELL\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'SHELL'), # KC-135 tanker
        (r'\bTEXAS\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'TEXAS'), # KC-10 tanker
        (r'\bTEAL\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'TEAL'),   # Reconnaissance
        (r'\bDRAGON\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'DRAGON'),
        (r'\bVIPER\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'VIPER'),
        (r'\bCOBRA\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'COBRA'),
        (r'\bHAWK\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'HAWK'),
        (r'\bEAGLE\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'EAGLE'),
        # Civil Air Patrol / Coast Guard
        (r'\bCAP\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'CAP'),
        (r'\bCAM\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'CAM'),
        (r'\bCOAST\s*GUARD\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'COASTGUARD'),
        (r'\bRESCUE\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'RESCUE'),
        # Law enforcement
        (r'\bCOPTER\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'COPTER'),  # Police helicopters
        (r'\bTROOPER\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'TROOPER'),
        (r'\bLIFE\s*GUARD\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'LIFEGUARD'),  # Medical emergency
        (r'\bLIFEGUARD\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'LIFEGUARD'),
        # Test / experimental
        (r'\bNASA\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'NASA'),
        (r'\bTEST\s*((?:\d+|(?:' + phonetic_num_words + r')\s*)+)', 'TEST'),
    ]

    for pattern, prefix in military_patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            num_part = match.group(1)
            if num_part.upper() in ('ONE', 'TWO'):
                flight_num = num_part.upper()
            else:
                flight_num = _normalize_flight_number(num_part) or num_part
            callsign = f"{prefix}{flight_num}".replace(" ", "")

            if callsign not in seen:
                seen.add(callsign)
                callsigns.append({
                    "callsign": callsign,
                    "raw": match.group(0).strip(),
                    "type": "military",
                    "confidence": 0.85,
                })

    # === Pattern 5: Direct ICAO code + numbers (e.g., "AAL123") ===
    icao_pattern = r'\b([A-Z]{3})(\d{1,4})\b'
    for match in re.finditer(icao_pattern, text):
        icao = match.group(1)
        flight_num = match.group(2)
        callsign = f"{icao}{flight_num}"

        if icao in AIRLINE_CALLSIGNS and callsign not in seen:
            seen.add(callsign)
            callsigns.append({
                "callsign": callsign,
                "raw": match.group(0).strip(),
                "type": "airline",
                "airline_icao": icao,
                "airline_name": AIRLINE_CALLSIGNS.get(icao),
                "flight_number": flight_num,
                "confidence": 0.95,
            })

    # === Pattern 6: GA aircraft type + tail (common shorthand) ===
    # Controllers often use aircraft type + last 3 of tail: "Cessna 3AB", "Cherokee 45X"
    ga_types = [
        "CESSNA", "PIPER", "CHEROKEE", "BONANZA", "BEECH", "BEECHCRAFT",
        "CIRRUS", "MOONEY", "CITATION", "LEARJET", "LEAR", "GULFSTREAM",
        "FALCON", "HAWKER", "CHALLENGER", "GLOBAL", "PHENOM", "PREMIER",
        "KING AIR", "KINGAIR", "CARAVAN", "PILATUS", "TBM", "SOCATA",
        "DIAMOND", "TECNAM", "SKYHAWK", "SKYLANE", "CENTURION",
        "ARCHER", "WARRIOR", "SARATOGA", "SENECA", "SEMINOLE", "AZTEC",
        "BARON", "DUCHESS", "TWIN STAR", "TWINSTAR",
        "HELICOPTER", "HELO", "COPTER", "ROTOR",
    ]
    ga_type_pattern = r'\b(' + '|'.join(ga_types) + r')\s+(\d{1,3})\s*([A-Z]{1,2})?\b'

    for match in re.finditer(ga_type_pattern, text, re.IGNORECASE):
        ac_type = match.group(1).upper()
        digits = match.group(2)
        letters = match.group(3) or ""

        # This is a partial tail number (last 3 of N-number)
        partial_tail = f"{digits}{letters}".upper()
        callsign = f"{ac_type[:3]}{partial_tail}"  # Use first 3 chars of type + tail

        if callsign not in seen and len(partial_tail) >= 2:
            seen.add(callsign)
            callsigns.append({
                "callsign": callsign,
                "raw": match.group(0).strip(),
                "type": "general_aviation",
                "aircraft_type": ac_type,
                "partial_tail": partial_tail,
                "confidence": 0.65,  # Lower confidence since it's partial
            })

    # Sort by confidence (highest first)
    callsigns.sort(key=lambda x: x.get("confidence", 0.5), reverse=True)

    logger.debug(f"Extracted {len(callsigns)} callsigns from transcript")
    return callsigns


def _find_text_position(text: str, search_text: str) -> Optional[int]:
    """Find the character position of search_text in text (case-insensitive)."""
    text_upper = text.upper()
    search_upper = search_text.upper()
    pos = text_upper.find(search_upper)
    return pos if pos >= 0 else None


def _estimate_time_from_position(
    position: int,
    total_length: int,
    duration_seconds: Optional[float],
    segments: Optional[list] = None,
) -> Optional[float]:
    """
    Estimate the time offset for a character position in the transcript.

    Uses word-level segments if available (from Whisper), otherwise
    estimates based on character position and total duration.

    Args:
        position: Character position in transcript
        total_length: Total transcript length
        duration_seconds: Total audio duration
        segments: Optional word-level segments from Whisper

    Returns:
        Estimated time in seconds, or None if cannot estimate
    """
    if duration_seconds is None or duration_seconds <= 0:
        return None

    if total_length <= 0:
        return 0.0

    # If we have word-level segments, use them for more accurate timing
    if segments:
        # Segments format varies by transcription service
        # Whisper typically provides: [{"start": 0.0, "end": 1.5, "text": "word"}, ...]
        char_count = 0
        for seg in segments:
            seg_text = seg.get("text", "")
            seg_start = seg.get("start")
            seg_end = seg.get("end")

            if seg_start is not None and position >= char_count and position < char_count + len(seg_text) + 1:
                return float(seg_start)

            char_count += len(seg_text) + 1  # +1 for space between segments

    # Fallback: linear interpolation based on character position
    ratio = position / total_length
    return round(ratio * duration_seconds, 2)


async def identify_airframes_from_transcript(
    db: AsyncSession,
    transcript: str,
    segments: Optional[list] = None,
    duration_seconds: Optional[float] = None,
) -> list[dict]:
    """
    Identify airframes mentioned in a transcript by extracting callsigns.
    Supports multiple callsigns per transmission (e.g., controller talking to 2+ aircraft).

    Args:
        db: Database session
        transcript: The transcribed text
        segments: Optional word-level timestamp segments from transcription
        duration_seconds: Total audio duration for time estimation

    Returns:
        List of identified airframes with timing info, sorted by appearance order
    """
    callsigns = extract_callsigns_from_transcript(transcript)

    if not callsigns:
        return []

    total_length = len(transcript) if transcript else 0

    # For each callsign, build the airframe info with timing
    # Track order of appearance in transcript
    identified = []
    for idx, cs in enumerate(callsigns):
        raw_text = cs["raw"]

        # Find position in original transcript for timing
        position = _find_text_position(transcript, raw_text)
        start_time = None

        if position is not None:
            start_time = _estimate_time_from_position(
                position, total_length, duration_seconds, segments
            )

        airframe = {
            "callsign": cs["callsign"],
            "raw_text": raw_text,
            "type": cs["type"],
            "confidence": cs.get("confidence", 0.5),
            "position": position,  # Character position in transcript
            "start_time": start_time,  # Estimated time in seconds
            "mention_order": idx,  # Order found (0 = first mention)
        }

        # Add airline info if available
        if cs.get("airline_icao"):
            airframe["airline_icao"] = cs["airline_icao"]
            airframe["airline_name"] = cs.get("airline_name") or AIRLINE_CALLSIGNS.get(cs["airline_icao"])
        if cs.get("flight_number"):
            airframe["flight_number"] = cs["flight_number"]
        if cs.get("suffix"):
            airframe["suffix"] = cs["suffix"]
        if cs.get("aircraft_type"):
            airframe["aircraft_type"] = cs["aircraft_type"]
        if cs.get("partial_tail"):
            airframe["partial_tail"] = cs["partial_tail"]

        identified.append(airframe)

    # Sort by position/time (order of appearance) rather than confidence
    identified.sort(key=lambda x: (x.get("position") or 0, x.get("mention_order", 0)))

    # Re-assign mention_order after sorting by position
    for idx, airframe in enumerate(identified):
        airframe["mention_order"] = idx

    # Log multi-callsign transmissions for debugging
    if len(identified) > 1:
        callsign_list = [a["callsign"] for a in identified]
        logger.info(f"Multi-callsign transmission: {callsign_list}")

    logger.info(f"Identified {len(identified)} airframes from transcript")
    return identified


def _get_s3_client():
    """Get or create S3 client (lazy initialization)."""
    global _s3_client

    if _s3_client is not None:
        return _s3_client

    if not settings.s3_enabled:
        return None

    try:
        import boto3
        from botocore.config import Config

        config = Config(
            signature_version='s3v4',
            retries={'max_attempts': 3, 'mode': 'standard'}
        )

        client_kwargs = {
            'service_name': 's3',
            'region_name': settings.s3_region,
            'config': config,
        }

        if settings.s3_access_key and settings.s3_secret_key:
            client_kwargs['aws_access_key_id'] = settings.s3_access_key
            client_kwargs['aws_secret_access_key'] = settings.s3_secret_key

        if settings.s3_endpoint_url:
            client_kwargs['endpoint_url'] = settings.s3_endpoint_url

        _s3_client = boto3.client(**client_kwargs)
        logger.info(f"S3 client initialized for audio: bucket={settings.s3_bucket}")
        return _s3_client

    except ImportError:
        logger.error("boto3 not installed - S3 storage unavailable")
        return None
    except Exception as e:
        logger.error(f"Failed to initialize S3 client: {e}")
        return None


def get_audio_duration(audio_data: bytes) -> Optional[float]:
    """
    Calculate audio duration from raw audio bytes.
    
    Supports MP3, WAV, OGG, and FLAC formats.
    Uses byte-level parsing for fast duration calculation without full decode.
    
    Args:
        audio_data: Raw audio file bytes
        
    Returns:
        Duration in seconds, or None if unable to calculate
    """
    try:
        # Try using mutagen if available (fast, works with all formats)
        try:
            import mutagen
            audio_file = io.BytesIO(audio_data)
            audio = mutagen.File(audio_file)
            if audio and audio.info:
                return float(audio.info.length)
        except ImportError:
            pass
        
        # Fallback: Try MP3 parsing
        duration = _parse_mp3_duration(audio_data)
        if duration:
            return duration
        
        # Fallback: Try WAV parsing
        duration = _parse_wav_duration(audio_data)
        if duration:
            return duration
        
        logger.warning("Could not calculate audio duration from bytes")
        return None
        
    except Exception as e:
        logger.warning(f"Error calculating audio duration: {e}")
        return None


def _parse_mp3_duration(audio_data: bytes) -> Optional[float]:
    """Parse MP3 duration from frame headers (simplified)."""
    try:
        # MP3 frame header: FFFB (sync) + bitrate/samplerate info
        # This is a simplified parser - mutagen is preferred
        bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        samplerates = [44100, 48000, 32100]
        
        # Find first valid frame
        for i in range(len(audio_data) - 4):
            if audio_data[i] == 0xFF and (audio_data[i+1] & 0xE0) == 0xE0:
                # Found sync word
                # This is complex - better to use mutagen
                return None
        return None
    except:
        return None


def _parse_wav_duration(audio_data: bytes) -> Optional[float]:
    """Parse WAV duration from header."""
    try:
        if len(audio_data) < 40:
            return None
            
        # WAV format: check RIFF header
        if audio_data[0:4] != b'RIFF' or audio_data[8:12] != b'WAVE':
            return None
        
        # Find fmt chunk
        pos = 12
        while pos < len(audio_data) - 8:
            chunk_id = audio_data[pos:pos+4]
            chunk_size = int.from_bytes(audio_data[pos+4:pos+8], 'little')
            
            if chunk_id == b'fmt ':
                # Parse format
                num_channels = int.from_bytes(audio_data[pos+8:pos+10], 'little')
                sample_rate = int.from_bytes(audio_data[pos+10:pos+14], 'little')
                bytes_per_sample = int.from_bytes(audio_data[pos+22:pos+24], 'little') // 8 if pos+24 <= len(audio_data) else 2
                
                # Find data chunk
                pos2 = pos + 8 + chunk_size
                while pos2 < len(audio_data) - 8:
                    if audio_data[pos2:pos2+4] == b'data':
                        data_size = int.from_bytes(audio_data[pos2+4:pos2+8], 'little')
                        total_samples = data_size // (num_channels * bytes_per_sample)
                        duration = total_samples / sample_rate
                        return duration
                    pos2 += 8 + int.from_bytes(audio_data[pos2+4:pos2+8], 'little')
                return None
            
            pos += 8 + chunk_size
        return None
    except:
        return None


def _get_s3_key(filename: str) -> str:
    """Get S3 key for audio file."""
    prefix = settings.radio_s3_prefix.strip("/")
    return f"{prefix}/{filename}"


def _get_s3_url(filename: str) -> str:
    """Get public URL for S3 audio file (non-signed, for public buckets)."""
    key = _get_s3_key(filename)

    if settings.s3_public_url:
        base = settings.s3_public_url.rstrip("/")
        # Remove prefix from key if public URL already includes it
        prefix_with_slash = settings.radio_s3_prefix.strip("/") + "/"
        if settings.radio_s3_prefix and key.startswith(prefix_with_slash):
            key = key[len(prefix_with_slash):]
        return f"{base}/{key}"

    if settings.s3_endpoint_url:
        endpoint = settings.s3_endpoint_url.rstrip("/")
        return f"{endpoint}/{settings.s3_bucket}/{key}"

    return f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com/{key}"


def get_signed_s3_url(filename: str, expires_in: int = 3600) -> Optional[str]:
    """
    Generate a signed URL for S3 audio file access.

    Args:
        filename: The filename in S3
        expires_in: URL expiration time in seconds (default 1 hour)

    Returns:
        Signed URL or None if S3 is not available
    """
    client = _get_s3_client()
    if not client:
        return None

    key = _get_s3_key(filename)

    try:
        url = client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': settings.s3_bucket,
                'Key': key,
            },
            ExpiresIn=expires_in,
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate signed URL for {filename}: {e}")
        return None


def get_local_audio_url(filename: str) -> str:
    """
    Get URL for locally stored audio file (served via API).

    Args:
        filename: The filename

    Returns:
        URL path to access the file via API
    """
    return f"/api/v1/audio/file/{filename}"


def get_audio_url(filename: str, s3_key: Optional[str] = None, signed: bool = True) -> Optional[str]:
    """
    Get accessible URL for an audio file (S3 signed URL or local API URL).

    Args:
        filename: The audio filename
        s3_key: S3 key if stored in S3
        signed: Whether to generate a signed URL for S3 (default True)

    Returns:
        Accessible URL for the audio file
    """
    if s3_key and settings.s3_enabled:
        # S3 storage - generate signed URL for private access
        if signed:
            return get_signed_s3_url(filename)
        else:
            return _get_s3_url(filename)
    else:
        # Local storage - return API endpoint URL
        return get_local_audio_url(filename)


async def upload_to_s3(
    data: bytes,
    filename: str,
    content_type: str = "audio/mpeg"
) -> Optional[str]:
    """
    Upload audio file to S3.

    Args:
        data: Audio file bytes
        filename: Filename to use in S3
        content_type: MIME type of the audio

    Returns:
        S3 URL or None on failure
    """
    client = _get_s3_client()
    if not client:
        logger.warning("S3 client not available, skipping upload")
        return None

    key = _get_s3_key(filename)

    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: client.put_object(
                Bucket=settings.s3_bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl='max-age=86400',  # 1 day cache
            )
        )

        url = _get_s3_url(filename)
        _stats["uploads"] += 1
        logger.info(f"Uploaded audio to S3: {key}")
        return url

    except Exception as e:
        _stats["upload_errors"] += 1
        logger.error(f"S3 upload failed for {filename}: {e}")
        return None


async def save_audio_locally(
    audio_data: bytes,
    filename: str
) -> Optional[Path]:
    """
    Save audio file to local storage.

    Args:
        audio_data: Raw audio bytes
        filename: Filename to save as

    Returns:
        Path to saved file or None on failure
    """
    try:
        audio_dir = Path(settings.radio_audio_dir)
        audio_dir.mkdir(parents=True, exist_ok=True)

        file_path = audio_dir / filename
        file_path.write_bytes(audio_data)

        logger.info(f"Saved audio locally: {file_path}")
        return file_path

    except Exception as e:
        logger.error(f"Failed to save audio locally: {e}")
        return None


async def create_transmission(
    db: AsyncSession,
    audio_data: bytes,
    filename: str,
    frequency_mhz: Optional[float] = None,
    channel_name: Optional[str] = None,
    duration_seconds: Optional[float] = None,
    metadata: Optional[dict] = None,
    queue_transcription: bool = True,
) -> AudioTransmission:
    """
    Create an audio transmission record, upload to S3, and optionally queue transcription.

    Args:
        db: Database session
        audio_data: Raw audio bytes
        filename: Filename for the audio
        frequency_mhz: Radio frequency
        channel_name: Channel name
        duration_seconds: Audio duration
        metadata: Additional metadata
        queue_transcription: Whether to queue for transcription

    Returns:
        Created AudioTransmission record
    """
    # Determine format from filename
    file_ext = Path(filename).suffix.lower().lstrip(".")
    audio_format = file_ext if file_ext in ("mp3", "wav", "ogg", "flac") else "mp3"

    # Calculate duration if not provided
    if duration_seconds is None or duration_seconds == 0:
        calculated_duration = get_audio_duration(audio_data)
        if calculated_duration:
            duration_seconds = calculated_duration
            logger.info(f"Calculated audio duration: {duration_seconds:.2f}s for {filename}")
        else:
            duration_seconds = None

    # Upload to S3 or save locally
    s3_url = None
    s3_key = None
    if settings.s3_enabled:
        content_type = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "ogg": "audio/ogg",
            "flac": "audio/flac",
        }.get(audio_format, "audio/mpeg")

        s3_url = await upload_to_s3(audio_data, filename, content_type)
        if s3_url:
            s3_key = _get_s3_key(filename)
    else:
        # Save locally when S3 is disabled
        await save_audio_locally(audio_data, filename)

    # Create database record
    transmission = AudioTransmission(
        filename=filename,
        s3_key=s3_key,
        s3_url=s3_url,
        file_size_bytes=len(audio_data),
        duration_seconds=duration_seconds,
        format=audio_format,
        frequency_mhz=frequency_mhz,
        channel_name=channel_name,
        transcription_status="pending",
        metadata=metadata,
    )

    db.add(transmission)
    await db.commit()
    await db.refresh(transmission)

    logger.info(f"Created audio transmission {transmission.id}: {filename}")

    # Queue for transcription if enabled (whisper or external service)
    if queue_transcription and (settings.transcription_enabled or settings.whisper_enabled):
        await queue_transcription_job(db, transmission.id)

    return transmission


async def queue_transcription_job(db: AsyncSession, transmission_id: int) -> bool:
    """
    Queue a transcription job for an audio transmission.

    Args:
        db: Database session
        transmission_id: ID of the transmission to transcribe

    Returns:
        True if queued successfully
    """
    if not settings.transcription_enabled and not settings.whisper_enabled:
        logger.debug("Transcription is not enabled (neither whisper nor external)")
        return False

    if _transcription_queue is None:
        logger.error("Transcription queue not initialized")
        return False

    try:
        # Add to queue first to ensure it succeeds before updating DB
        await _transcription_queue.put(transmission_id)

        # Update status to queued
        await db.execute(
            update(AudioTransmission)
            .where(AudioTransmission.id == transmission_id)
            .values(
                transcription_status="queued",
                transcription_queued_at=datetime.utcnow()
            )
        )
        await db.commit()

        _stats["transcriptions_queued"] += 1
        logger.info(f"Queued transcription for transmission {transmission_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to queue transcription for {transmission_id}: {e}")
        return False


async def _transcribe_with_whisper(
    client: httpx.AsyncClient,
    audio_data: bytes,
    filename: str,
) -> dict:
    """
    Transcribe audio using local Whisper service.

    The onerahmet/openai-whisper-asr-webservice API requires file upload via multipart form.
    """
    whisper_url = f"{settings.whisper_url}/asr"

    # Determine content type from filename
    ext = Path(filename).suffix.lower().lstrip(".")
    content_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "m4a": "audio/mp4",
        "webm": "audio/webm",
    }.get(ext, "audio/mpeg")

    # Whisper ASR webservice requires multipart file upload
    files = {
        "audio_file": (filename, audio_data, content_type),
    }
    params = {
        "task": "transcribe",
        "language": "en",
        "output": "json",
    }

    response = await client.post(whisper_url, params=params, files=files)
    response.raise_for_status()
    return response.json()


async def _transcribe_with_external_service(
    client: httpx.AsyncClient,
    audio_data: bytes,
    filename: str,
) -> dict:
    """
    Transcribe audio using external transcription service (Speaches.ai compatible).

    Uses OpenAI-compatible /v1/audio/transcriptions endpoint with multipart form data.
    """
    # Determine content type from filename
    ext = Path(filename).suffix.lower().lstrip(".")
    content_type = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "m4a": "audio/mp4",
        "webm": "audio/webm",
    }.get(ext, "audio/mpeg")

    # Build endpoint URL (ensure it ends with /v1/audio/transcriptions)
    base_url = settings.transcription_service_url.rstrip("/")
    if not base_url.endswith("/v1/audio/transcriptions"):
        if base_url.endswith("/v1"):
            endpoint = f"{base_url}/audio/transcriptions"
        else:
            endpoint = f"{base_url}/v1/audio/transcriptions"
    else:
        endpoint = base_url

    # Prepare multipart form data
    files = {
        "file": (filename, audio_data, content_type),
    }
    data = {
        "model": settings.transcription_model or "Systran/faster-whisper-small.en",
        "language": "en",
    }

    # Add API key header if configured
    headers = {}
    if settings.transcription_api_key:
        headers["Authorization"] = f"Bearer {settings.transcription_api_key}"

    response = await client.post(endpoint, files=files, data=data, headers=headers)
    response.raise_for_status()
    return response.json()


async def _fetch_audio_data(
    client: httpx.AsyncClient,
    filename: str,
    s3_key: Optional[str],
) -> Optional[bytes]:
    """
    Fetch audio data from S3 or local storage.

    Args:
        client: HTTP client for fetching from URLs
        filename: The audio filename
        s3_key: S3 key if stored in S3

    Returns:
        Audio bytes or None if fetch failed
    """
    try:
        if s3_key and settings.s3_enabled:
            # Fetch from S3 using signed URL
            audio_url = get_signed_s3_url(filename)
            if not audio_url:
                logger.error(f"Failed to generate signed URL for {filename}")
                return None
            response = await client.get(audio_url)
            response.raise_for_status()
            return response.content
        else:
            # Read from local storage
            audio_path = Path(settings.radio_audio_dir) / filename
            if not audio_path.exists():
                logger.error(f"Local audio file not found: {audio_path}")
                return None
            return audio_path.read_bytes()
    except Exception as e:
        logger.error(f"Failed to fetch audio data for {filename}: {e}")
        return None


async def process_transcription(
    db_session_factory,
    transmission_id: int
) -> bool:
    """
    Process a transcription job.

    Args:
        db_session_factory: Async session factory
        transmission_id: ID of the transmission to transcribe

    Returns:
        True if transcription succeeded
    """
    # Check if we have a transcription service configured
    if not settings.whisper_enabled and not settings.transcription_service_url:
        logger.error("No transcription service configured (whisper or external)")
        return False

    async with db_session_factory() as db:
        # Get transmission
        result = await db.execute(
            select(AudioTransmission).where(AudioTransmission.id == transmission_id)
        )
        transmission = result.scalar_one_or_none()

        if not transmission:
            logger.error(f"Transmission {transmission_id} not found")
            return False

        # Update status to processing
        transmission.transcription_status = "processing"
        transmission.transcription_started_at = datetime.utcnow()
        await db.commit()

        try:
            # Call transcription service
            async with httpx.AsyncClient(timeout=120.0) as client:
                # Both whisper and external service need audio file data
                audio_data = await _fetch_audio_data(
                    client, transmission.filename, transmission.s3_key
                )
                if not audio_data:
                    raise ValueError("Failed to fetch audio data")

                if settings.whisper_enabled:
                    # Whisper service uses multipart file upload
                    result_data = await _transcribe_with_whisper(
                        client, audio_data, transmission.filename
                    )
                else:
                    # External service (Speaches.ai compatible)
                    result_data = await _transcribe_with_external_service(
                        client, audio_data, transmission.filename
                    )

                # Update with transcription result
                transcript_text = result_data.get("text", "")
                transmission.transcription_status = "completed"
                transmission.transcription_completed_at = datetime.utcnow()
                transmission.transcript = transcript_text
                transmission.transcript_confidence = result_data.get("confidence")
                transmission.transcript_language = result_data.get("language", "en")
                transmission.transcript_segments = result_data.get("segments")

                # Identify airframes mentioned in the transcript
                if transcript_text:
                    identified = await identify_airframes_from_transcript(
                        db,
                        transcript_text,
                        segments=result_data.get("segments"),
                        duration_seconds=transmission.duration_seconds,
                    )
                    if identified:
                        transmission.identified_airframes = identified
                        logger.info(f"Identified {len(identified)} airframes in transmission {transmission_id}")

                await db.commit()
                _stats["transcriptions_completed"] += 1
                logger.info(f"Transcription completed for {transmission_id}")
                return True

        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP {e.response.status_code}"
            transmission.transcription_status = "failed"
            transmission.transcription_error = error_msg
            await db.commit()
            _stats["transcriptions_failed"] += 1
            logger.error(f"Transcription failed for {transmission_id}: {error_msg}")
            return False

        except Exception as e:
            transmission.transcription_status = "failed"
            error_msg = str(e) or repr(e) or type(e).__name__
            transmission.transcription_error = error_msg
            await db.commit()
            _stats["transcriptions_failed"] += 1
            logger.error(f"Transcription failed for {transmission_id}: {error_msg}")
            return False


async def init_transcription_queue():
    """Initialize the transcription queue."""
    global _transcription_queue, _whisper_semaphore
    _transcription_queue = asyncio.Queue()
    # Limit to 1 concurrent transcription when using Whisper (resource-intensive)
    _whisper_semaphore = asyncio.Semaphore(1)
    logger.info("Transcription queue initialized")


async def process_transcription_queue(db_session_factory):
    """
    Background task to process transcription queue.

    Args:
        db_session_factory: Async session factory
    """
    global _transcription_queue, _whisper_semaphore

    if _transcription_queue is None:
        await init_transcription_queue()

    logger.info("Transcription queue processor started")

    while True:
        try:
            # Wait for next job
            try:
                transmission_id = await asyncio.wait_for(
                    _transcription_queue.get(),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                continue

            # Use semaphore to limit concurrent Whisper transcriptions to 1
            if settings.whisper_enabled and _whisper_semaphore is not None:
                async with _whisper_semaphore:
                    await process_transcription(db_session_factory, transmission_id)
            else:
                await process_transcription(db_session_factory, transmission_id)
            _transcription_queue.task_done()

            # Small delay between jobs
            await asyncio.sleep(0.5)

        except asyncio.CancelledError:
            logger.info("Transcription queue processor stopping")
            break
        except Exception as e:
            logger.error(f"Error in transcription queue processor: {e}")
            await asyncio.sleep(1)


async def get_transmission(
    db: AsyncSession,
    transmission_id: int
) -> Optional[AudioTransmission]:
    """Get a single transmission by ID."""
    result = await db.execute(
        select(AudioTransmission).where(AudioTransmission.id == transmission_id)
    )
    return result.scalar_one_or_none()


async def get_transmissions(
    db: AsyncSession,
    status: Optional[str] = None,
    channel: Optional[str] = None,
    hours: int = 24,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[AudioTransmission], int]:
    """
    Get audio transmissions with optional filters.

    Returns:
        Tuple of (transmissions, total_count)
    """
    from datetime import timedelta

    query = select(AudioTransmission)
    count_query = select(func.count(AudioTransmission.id))

    # Time filter
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    query = query.where(AudioTransmission.created_at >= cutoff)
    count_query = count_query.where(AudioTransmission.created_at >= cutoff)

    # Status filter
    if status:
        query = query.where(AudioTransmission.transcription_status == status)
        count_query = count_query.where(AudioTransmission.transcription_status == status)

    # Channel filter
    if channel:
        query = query.where(AudioTransmission.channel_name == channel)
        count_query = count_query.where(AudioTransmission.channel_name == channel)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated results
    query = query.order_by(AudioTransmission.created_at.desc())
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    transmissions = list(result.scalars().all())

    return transmissions, total


async def get_matched_radio_calls(
    db: AsyncSession,
    callsign: Optional[str] = None,
    icao_hex: Optional[str] = None,
    operator_icao: Optional[str] = None,
    registration: Optional[str] = None,
    hours: int = 24,
    limit: int = 10,
) -> list[dict]:
    """
    Get audio transmissions that mention a specific aircraft.

    Matches are found by searching the identified_airframes JSON field
    for callsigns that match the provided criteria.

    Args:
        db: Database session
        callsign: Flight callsign to match (e.g., "UAL123")
        icao_hex: ICAO hex code - used to look up callsign from current aircraft
        operator_icao: Operator ICAO code (e.g., "UAL") - matches any flight by this operator
        registration: Aircraft registration (e.g., "N12345") - for GA aircraft
        hours: How many hours back to search
        limit: Maximum number of results

    Returns:
        List of matched radio call dicts with transmission info and match details
    """
    from datetime import timedelta

    if not callsign and not icao_hex and not operator_icao and not registration:
        return []

    cutoff = datetime.utcnow() - timedelta(hours=hours)

    # Build query for transmissions with completed transcripts
    query = (
        select(AudioTransmission)
        .where(AudioTransmission.transcription_status == "completed")
        .where(AudioTransmission.identified_airframes.isnot(None))
        .where(AudioTransmission.created_at >= cutoff)
        .order_by(AudioTransmission.created_at.desc())
    )

    result = await db.execute(query)
    transmissions = result.scalars().all()

    matched_calls = []

    for tx in transmissions:
        if not tx.identified_airframes:
            continue

        # Search through identified airframes for matches
        for airframe in tx.identified_airframes:
            af_callsign = airframe.get("callsign", "")
            af_airline_icao = airframe.get("airline_icao", "")
            af_type = airframe.get("type", "")

            matched = False
            match_confidence = airframe.get("confidence", 0.5)
            match_raw_text = airframe.get("raw_text", "")

            # Match by exact callsign
            if callsign and af_callsign.upper() == callsign.upper():
                matched = True

            # Match by operator ICAO (any flight by this airline)
            elif operator_icao and af_airline_icao.upper() == operator_icao.upper():
                matched = True

            # Match by registration (for GA aircraft like N-numbers)
            elif registration and af_type == "general_aviation":
                # Check if callsign is the registration
                if af_callsign.upper() == registration.upper():
                    matched = True
                # Also check partial tail matches
                elif airframe.get("partial_tail"):
                    partial = airframe.get("partial_tail", "").upper()
                    if partial and registration.upper().endswith(partial):
                        matched = True

            if matched:
                # Get audio URL
                audio_url = None
                if tx.s3_key:
                    audio_url = get_signed_s3_url(tx.filename)
                else:
                    audio_url = get_local_audio_url(tx.filename)

                matched_calls.append({
                    "id": tx.id,
                    "created_at": tx.created_at.isoformat() + "Z",
                    "transcript": tx.transcript,
                    "frequency_mhz": tx.frequency_mhz,
                    "channel_name": tx.channel_name,
                    "duration_seconds": tx.duration_seconds,
                    "confidence": match_confidence,
                    "raw_text": match_raw_text,
                    "audio_url": audio_url,
                    "matched_callsign": af_callsign,
                })

                # Only count each transmission once per aircraft
                break

        if len(matched_calls) >= limit:
            break

    return matched_calls


async def get_audio_stats(db: AsyncSession) -> dict:
    """Get audio transmission statistics."""
    from datetime import timedelta

    # Total counts by status
    status_query = select(
        AudioTransmission.transcription_status,
        func.count(AudioTransmission.id)
    ).group_by(AudioTransmission.transcription_status)

    status_result = await db.execute(status_query)
    by_status = {row[0]: row[1] for row in status_result}

    # Channel counts
    channel_query = select(
        AudioTransmission.channel_name,
        func.count(AudioTransmission.id)
    ).where(
        AudioTransmission.channel_name.isnot(None)
    ).group_by(AudioTransmission.channel_name)

    channel_result = await db.execute(channel_query)
    by_channel = {row[0]: row[1] for row in channel_result}

    # Totals
    total_query = select(
        func.count(AudioTransmission.id),
        func.sum(AudioTransmission.duration_seconds),
        func.sum(AudioTransmission.file_size_bytes)
    )
    total_result = await db.execute(total_query)
    totals = total_result.one()

    total_count = totals[0] or 0
    total_duration = totals[1] or 0
    total_size = totals[2] or 0

    return {
        "total_transmissions": total_count,
        "total_transcribed": by_status.get("completed", 0),
        "pending_transcription": by_status.get("pending", 0) + by_status.get("queued", 0),
        "failed_transcription": by_status.get("failed", 0),
        "total_duration_hours": round(total_duration / 3600, 2) if total_duration else 0,
        "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size else 0,
        "by_channel": by_channel,
        "by_status": by_status,
        "service_stats": _stats.copy(),
    }


def get_service_stats() -> dict:
    """Get service-level statistics."""
    return {
        "radio_enabled": settings.radio_enabled,
        "radio_audio_dir": settings.radio_audio_dir,
        "transcription_enabled": settings.transcription_enabled or settings.whisper_enabled,
        "whisper_enabled": settings.whisper_enabled,
        "whisper_url": settings.whisper_url if settings.whisper_enabled else None,
        "s3_enabled": settings.s3_enabled,
        "s3_prefix": settings.radio_s3_prefix,
        "queue_size": _transcription_queue.qsize() if _transcription_queue else 0,
        **_stats,
    }
