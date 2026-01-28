"""
Audio transmission service for rtl-airband radio.

Handles:
- Receiving audio uploads from rtl-airband
- Uploading to S3 or saving locally
- Transcription via Whisper/ATC-Whisper/external services
- Callsign extraction from transcripts
- URL generation for audio playback
"""
import io
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from django.conf import settings
from django.utils import timezone

from skyspy.models import AudioTransmission
from skyspy.services.storage import (
    upload_to_s3,
    download_from_s3,
    save_file_locally,
    read_local_file,
    generate_signed_url,
    get_s3_key,
    sanitize_filename,
)
from skyspy.services.llm import enhance_callsign_extraction

logger = logging.getLogger(__name__)

# Audio quality thresholds
AUDIO_MIN_DURATION_SECONDS = 0.5
AUDIO_MAX_DURATION_SECONDS = 120.0
AUDIO_MIN_RMS_THRESHOLD = 100  # Minimum RMS energy to avoid static
AUDIO_SILENCE_RATIO_MAX = 0.95  # Max ratio of silence in audio

# ATC-specific prompt for Whisper to improve domain accuracy
# This helps Whisper recognize aviation terminology and callsign patterns
ATC_WHISPER_PROMPT = """Air traffic control radio communication. Common callsigns: United, Delta, American, Southwest, JetBlue, Alaska, Frontier, Spirit, SkyWest, FedEx, UPS, Speedbird, Lufthansa, Air France, Air Canada, Emirates, Qantas. Military: Air Force, Navy, Army, Reach, Evac, Coast Guard. General aviation with N-numbers like November 12345 Alpha Bravo.

ATC terminology: cleared, contact, descend, climb, maintain, runway, approach, departure, tower, ground, center, approach control, departure control, squawk, ident, roger, wilco, affirm, negative, say again, read back, taxi, hold short, line up and wait, cleared for takeoff, cleared to land, go around, missed approach, vectors, direct, flight level, altitude, heading, speed, knots, degrees, ILS, RNAV, VOR, localizer, glideslope, traffic, caution, wake turbulence, heavy, super.

Frequencies like 121.5, 118.7, 125.35. Flight levels FL350, FL410. Altitudes in thousands: one seven thousand, flight level three five zero. Squawk codes: 7500 hijack, 7600 radio failure, 7700 emergency. Phonetic alphabet: Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel, India, Juliet, Kilo, Lima, Mike, November, Oscar, Papa, Quebec, Romeo, Sierra, Tango, Uniform, Victor, Whiskey, X-ray, Yankee, Zulu. Numbers: zero, one, two, three, four, fife, six, seven, eight, niner."""

# Service statistics
_stats = {
    "uploads": 0,
    "upload_errors": 0,
    "transcriptions_queued": 0,
    "transcriptions_completed": 0,
    "transcriptions_failed": 0,
    "rejected_too_short": 0,
    "rejected_too_long": 0,
    "rejected_static": 0,
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

# Phonetic alphabet for number parsing (extended with common mishearings)
PHONETIC_NUMBERS = {
    # Standard
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    # ATC variants
    "niner": "9", "fife": "5", "tree": "3", "fower": "4",
    # Common homophones
    "won": "1", "wan": "1", "wun": "1",
    "to": "2", "too": "2", "tu": "2", "tew": "2",
    "for": "4", "fore": "4", "foor": "4",
    "ate": "8", "ait": "8",
    "free": "3",
    # Zero variants
    "oh": "0", "o": "0", "nil": "0", "hero": "0", "ziro": "0",
    # Mishearings
    "won't": "1", "want": "1",
    "too-er": "2", "tower": "2",
    "sicks": "6", "sex": "6",
    "nein": "9", "line": "9",
    # Compound numbers
    "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
    "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70",
    "eighty": "80", "ninety": "90", "hundred": "00",
}

# Phonetic alphabet letters (extended with common mishearings)
PHONETIC_LETTERS = {
    # Standard ICAO
    "alpha": "A", "alfa": "A", "bravo": "B", "charlie": "C", "delta": "D",
    "echo": "E", "foxtrot": "F", "golf": "G", "hotel": "H", "india": "I",
    "juliet": "J", "juliett": "J", "kilo": "K", "lima": "L", "mike": "M",
    "november": "N", "oscar": "O", "papa": "P", "quebec": "Q", "romeo": "R",
    "sierra": "S", "tango": "T", "uniform": "U", "victor": "V", "whiskey": "W",
    "xray": "X", "x-ray": "X", "yankee": "Y", "zulu": "Z",
    # Common mishearings
    "brah": "B", "bruh": "B",
    "char": "C", "charley": "C", "charly": "C",
    "del": "D", "delt": "D",
    "ech": "E", "ecko": "E",
    "fox": "F", "foxrot": "F",
    "gol": "G", "gulf": "G",
    "hoe": "H", "ho": "H",
    "indie": "I", "indy": "I",
    "jules": "J", "julie": "J",
    "key": "K", "kee": "K",
    "lee": "L", "lema": "L",
    "mic": "M", "my": "M",
    "nova": "N", "nov": "N",
    "pop": "P", "poppa": "P",
    "keh": "Q", "kebec": "Q",
    "see": "S", "sera": "S",
    "tang": "T",
    "uni": "U", "you": "U",
    "vic": "V", "viktor": "V",
    "whis": "W", "wisky": "W",
    "ex": "X", "ray": "X",
    "yank": "Y", "yang": "Y",
    "zoo": "Z", "zul": "Z",
}

# General aviation aircraft types for pattern matching
GA_AIRCRAFT_TYPES = {
    "CESSNA": "C", "PIPER": "P", "BEECH": "BE", "BEECHCRAFT": "BE",
    "CIRRUS": "SR", "MOONEY": "M", "BONANZA": "BE",
    "SKYLANE": "C182", "SKYHAWK": "C172", "CITATION": "C",
    "KING AIR": "BE", "BARON": "BE", "LANCE": "P",
    "CHEROKEE": "P", "ARCHER": "P", "WARRIOR": "P",
    "DIAMOND": "DA", "SOCATA": "TB", "TECNAM": "P",
}

# Airline name variants and common misspellings
AIRLINE_VARIANTS = {
    "UNITED": "UAL", "AMERICAN": "AAL", "DELTA": "DAL",
    "SOUTHWEST": "SWA", "JETBLUE": "JBU", "JET BLUE": "JBU",
    "ALASKA": "ASA", "FRONTIER": "FFT", "SPIRIT": "NKS",
    "SKYWEST": "SKW", "FEDEX": "FDX", "FED EX": "FDX",
    "UPS": "UPS", "ATLAS": "GTI", "GIANT": "GTI",
    "SPEEDBIRD": "BAW", "BRITISH": "BAW", "AIR FRANCE": "AFR",
    "LUFTHANSA": "DLH", "KLM": "KLM", "AIR CANADA": "ACA",
    "QANTAS": "QFA", "EMIRATES": "UAE", "SINGAPORE": "SIA",
    "CATHAY": "CPA", "VIRGIN": "VIR", "RYANAIR": "RYR",
    "EASYJET": "EZY", "TURKISH": "THY", "QATAR": "QTR",
    "JAPAN": "JAL", "KOREAN": "KAL",
}


def _convert_phonetic_to_digits(text: str) -> str:
    """Convert phonetic numbers in text to digits."""
    words = text.lower().split()
    result = []

    i = 0
    while i < len(words):
        clean_word = re.sub(r'[^\w\-]', '', words[i]).replace('-', '')

        if clean_word in PHONETIC_NUMBERS:
            val = PHONETIC_NUMBERS[clean_word]
            if clean_word == "hundred" and result:
                if len(result) >= 1 and result[-1] in "123456789":
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
            if result:
                break
            i += 1

    return ''.join(result)


def _normalize_flight_number(text: str) -> Optional[str]:
    """Extract and normalize a flight number from text."""
    digit_match = re.search(r'\d{1,4}', text)
    if digit_match:
        return digit_match.group()

    converted = _convert_phonetic_to_digits(text)
    if converted and len(converted) <= 4:
        return converted

    spaced_digits = re.findall(r'\b(\d)\b', text)
    if spaced_digits and len(spaced_digits) <= 4:
        return ''.join(spaced_digits)

    return None


def _preprocess_transcript(text: str) -> str:
    """Preprocess transcript to normalize common ATC speech patterns."""
    text = ' '.join(text.split())

    replacements = [
        (r'\bROGER\s+THAT\b', 'ROGER'),
        (r'\bCOPY\s+THAT\b', 'ROGER'),
        (r'\bWILCO\b', ''),
        (r'\bUH+\b', ''),
        (r'\bUM+\b', ''),
        (r'\bFLIGHT\s+', ''),
        (r'\bHEAVY\s+HEAVY\b', 'HEAVY'),
    ]

    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    return text.strip()


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


def _fuzzy_match_airline(word: str) -> Optional[tuple]:
    """Fuzzy match an airline name, returning (matched_name, icao_code) or None."""
    word_upper = word.upper().strip()

    if word_upper in AIRLINE_VARIANTS:
        return (word_upper, AIRLINE_VARIANTS[word_upper])

    cleaned = re.sub(r"['\-]", "", word_upper)
    if cleaned in AIRLINE_VARIANTS:
        return (cleaned, AIRLINE_VARIANTS[cleaned])

    for airline, icao in AIRLINE_VARIANTS.items():
        if len(airline) < 4:
            continue

        if len(word_upper) >= len(airline) - 2 and len(word_upper) <= len(airline) + 2:
            distance = _levenshtein_distance(word_upper, airline)
            max_distance = 1 if len(airline) <= 6 else 2

            if distance <= max_distance:
                return (airline, icao)

    return None


def extract_callsigns_from_transcript(
    transcript: str,
    use_llm: bool = True,
) -> list[dict]:
    """
    Extract aviation callsigns from a transcript with fuzzy matching.

    Handles:
    - Phonetic numbers: "United one two three" -> UAL123
    - ATC shortspeak: "Delta twenty three" -> DAL23
    - N-numbers: "November 12345" -> N12345
    - Military callsigns: "REACH 123" -> REACH123

    Args:
        transcript: The transcript text to extract callsigns from
        use_llm: Whether to use LLM for enhanced validation (default True)

    Returns:
        List of dicts with callsign info and confidence scores.
        When LLM is enabled, results include:
        - llm_validated: Whether LLM validation was performed
        - llm_valid: Whether LLM considers the callsign valid
        - llm_resolved: Whether LLM resolved an ambiguous callsign
        - linked_to: Primary callsign if this is a duplicate mention
    """
    if not transcript:
        return []

    callsigns = []
    seen = set()

    text = _preprocess_transcript(transcript).upper()

    # Pattern 1: Airline name + flight number
    airline_names = '|'.join(re.escape(name) for name in AIRLINE_VARIANTS.keys())
    phonetic_num_words = '|'.join(PHONETIC_NUMBERS.keys())
    airline_pattern = rf'\b({airline_names})\s+((?:\d+|(?:{phonetic_num_words})\s*)+)\s*(HEAVY|SUPER)?'

    for match in re.finditer(airline_pattern, text, re.IGNORECASE):
        airline_raw = match.group(1).upper()
        number_part = match.group(2)
        suffix = match.group(3) or ""

        icao = AIRLINE_VARIANTS.get(airline_raw)
        if not icao:
            continue

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

    # Pattern 2: N-numbers (general aviation)
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

    # Pattern 3: November + phonetic/numbers
    november_pattern = r'\bNOVEMBER\s+(.+?)(?=\s+(?:CLEARED|CONTACT|RUNWAY|TAXI|HOLD)|[,.]|$)'
    for match in re.finditer(november_pattern, text, re.IGNORECASE):
        tail_part = match.group(1).strip()
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
                break

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

    # Pattern 4: Military callsigns
    military_prefixes = [
        ("AIR FORCE", "AIRFORCE"), ("NAVY", "NAVY"), ("ARMY", "ARMY"),
        ("MARINE", "MARINE"), ("REACH", "REACH"), ("EVAC", "EVAC"),
        ("KING", "KING"), ("PEDRO", "PEDRO"), ("JOLLY", "JOLLY"),
        ("COAST GUARD", "COASTGUARD"), ("RESCUE", "RESCUE"),
        ("NASA", "NASA"), ("SAM", "SAM"),
    ]

    for name, prefix in military_prefixes:
        pattern = rf'\b{name}\s*((?:\d+|(?:{phonetic_num_words})\s*)+)'
        for match in re.finditer(pattern, text, re.IGNORECASE):
            num_part = match.group(1)
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

    # Pattern 5: Direct ICAO code + numbers
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

    # Pattern 6: GA aircraft type + partial tail number
    # Handles "Cessna 3AB", "Piper 45X", etc.
    ga_types = '|'.join(re.escape(t) for t in GA_AIRCRAFT_TYPES.keys())
    ga_pattern = rf'\b({ga_types})\s+(\d{{1,3}})\s*([A-Z]{{1,2}})?'
    for match in re.finditer(ga_pattern, text, re.IGNORECASE):
        ac_type = match.group(1).upper()
        digits = match.group(2)
        letters = match.group(3) or ""

        # Create synthetic callsign
        partial_tail = f"{digits}{letters.upper()}"
        if len(partial_tail) >= 2 and partial_tail not in seen:
            seen.add(partial_tail)
            callsigns.append({
                "callsign": partial_tail,
                "raw": match.group(0).strip(),
                "type": "general_aviation",
                "aircraft_type": ac_type,
                "partial_tail": True,
                "confidence": 0.5,  # Lower confidence for partial
            })

    # Pattern 7: Fuzzy airline matching (multi-word lookahead)
    # Handles misspelled airlines like "UNTED" or "DALTE"
    words = text.split()
    for i, word in enumerate(words):
        # Skip if too short
        if len(word) < 4:
            continue

        # Try fuzzy match
        match = _fuzzy_match_airline(word)
        if match:
            airline_name, icao = match
            # Look ahead for flight number (up to 5 words)
            flight_num = None
            raw_end = i

            for j in range(i + 1, min(i + 6, len(words))):
                next_word = words[j].strip()
                potential_num = _normalize_flight_number(next_word)
                if potential_num:
                    flight_num = potential_num
                    raw_end = j
                    break
                # Continue if it's a phonetic word
                if next_word.lower() not in PHONETIC_NUMBERS:
                    break

            if flight_num:
                callsign = f"{icao}{flight_num}"
                if callsign not in seen:
                    seen.add(callsign)
                    raw_text = ' '.join(words[i:raw_end+1])
                    callsigns.append({
                        "callsign": callsign,
                        "raw": raw_text,
                        "type": "airline",
                        "airline_icao": icao,
                        "airline_name": AIRLINE_CALLSIGNS.get(icao, airline_name),
                        "flight_number": flight_num,
                        "fuzzy_matched": True,
                        "confidence": 0.6,  # Lower for fuzzy match
                    })

    # Sort by confidence
    callsigns.sort(key=lambda x: x.get("confidence", 0.5), reverse=True)

    # Apply LLM enhancement if enabled
    if use_llm and callsigns:
        try:
            callsigns = enhance_callsign_extraction(
                transcript,
                callsigns,
                validate=True,
                resolve_ambiguous=True,
                deduplicate=True,
            )
        except Exception as e:
            logger.warning(f"LLM enhancement failed, using regex-only results: {e}")

    return callsigns


def identify_airframes_from_transcript(
    transcript: str,
    segments: Optional[list] = None,
    duration_seconds: Optional[float] = None,
    use_llm: bool = True,
) -> list[dict]:
    """
    Identify airframes mentioned in a transcript by extracting callsigns.

    Args:
        transcript: The transcribed text
        segments: Optional word-level timestamp segments
        duration_seconds: Total audio duration for time estimation
        use_llm: Whether to use LLM for enhanced analysis (default True)

    Returns:
        List of identified airframes with timing info.
        When LLM is enabled, may include deduplication metadata
        linking multiple mentions of the same aircraft.
    """
    callsigns = extract_callsigns_from_transcript(transcript, use_llm=use_llm)

    if not callsigns:
        return []

    total_length = len(transcript) if transcript else 0
    identified = []

    for idx, cs in enumerate(callsigns):
        raw_text = cs["raw"]
        position = transcript.upper().find(raw_text.upper())

        start_time = None
        if position >= 0 and duration_seconds and total_length > 0:
            ratio = position / total_length
            start_time = round(ratio * duration_seconds, 2)

        airframe = {
            "callsign": cs["callsign"],
            "raw_text": raw_text,
            "type": cs["type"],
            "confidence": cs.get("confidence", 0.5),
            "position": position if position >= 0 else None,
            "start_time": start_time,
            "mention_order": idx,
        }

        if cs.get("airline_icao"):
            airframe["airline_icao"] = cs["airline_icao"]
            airframe["airline_name"] = cs.get("airline_name")
        if cs.get("flight_number"):
            airframe["flight_number"] = cs["flight_number"]
        if cs.get("suffix"):
            airframe["suffix"] = cs["suffix"]

        # Include LLM enhancement metadata
        if cs.get("llm_validated"):
            airframe["llm_validated"] = True
            airframe["llm_valid"] = cs.get("llm_valid", True)
        if cs.get("llm_resolved"):
            airframe["llm_resolved"] = True
            airframe["original_callsign"] = cs.get("original_callsign")
        if cs.get("linked_to"):
            airframe["linked_to"] = cs["linked_to"]
            airframe["is_duplicate"] = True

        identified.append(airframe)

    identified.sort(key=lambda x: (x.get("position") or 0, x.get("mention_order", 0)))

    for idx, airframe in enumerate(identified):
        airframe["mention_order"] = idx

    return identified


def get_audio_duration(audio_data: bytes) -> Optional[float]:
    """
    Calculate audio duration from raw audio bytes.

    Supports MP3, WAV, OGG, and FLAC formats.
    """
    try:
        try:
            import mutagen
            with io.BytesIO(audio_data) as audio_file:
                audio = mutagen.File(audio_file)
                if audio and audio.info:
                    return float(audio.info.length)
        except ImportError:
            # mutagen not installed, will fall back to WAV parsing
            logger.debug("mutagen not installed, using WAV parsing fallback")

        # Fallback: WAV parsing
        if audio_data[:4] == b'RIFF' and audio_data[8:12] == b'WAVE':
            return _parse_wav_duration(audio_data)

        return None

    except Exception as e:
        logger.warning(f"Error calculating audio duration: {e}")
        return None


def _parse_wav_duration(audio_data: bytes) -> Optional[float]:
    """Parse WAV duration from header."""
    try:
        if len(audio_data) < 40:
            return None

        pos = 12
        while pos < len(audio_data) - 8:
            chunk_id = audio_data[pos:pos+4]
            chunk_size = int.from_bytes(audio_data[pos+4:pos+8], 'little')

            if chunk_id == b'fmt ':
                num_channels = int.from_bytes(audio_data[pos+8:pos+10], 'little')
                sample_rate = int.from_bytes(audio_data[pos+10:pos+14], 'little')
                bytes_per_sample = int.from_bytes(audio_data[pos+22:pos+24], 'little') // 8

                if num_channels == 0 or sample_rate == 0 or bytes_per_sample == 0:
                    return None

                pos2 = pos + 8 + chunk_size
                while pos2 < len(audio_data) - 8:
                    if audio_data[pos2:pos2+4] == b'data':
                        data_size = int.from_bytes(audio_data[pos2+4:pos2+8], 'little')
                        total_samples = data_size // (num_channels * bytes_per_sample)
                        return total_samples / sample_rate
                    pos2 += 8 + int.from_bytes(audio_data[pos2+4:pos2+8], 'little')
                return None

            pos += 8 + chunk_size
        return None
    except Exception:
        return None


def check_audio_quality(
    audio_data: bytes,
    duration: Optional[float] = None
) -> tuple[bool, str]:
    """
    Check if audio meets quality thresholds for transcription.

    Returns:
        Tuple of (is_valid, rejection_reason or "ok")
    """
    # Check duration
    if duration is None:
        duration = get_audio_duration(audio_data)

    if duration is not None:
        if duration < AUDIO_MIN_DURATION_SECONDS:
            _stats["rejected_too_short"] += 1
            return False, f"Audio too short ({duration:.2f}s < {AUDIO_MIN_DURATION_SECONDS}s)"

        if duration > AUDIO_MAX_DURATION_SECONDS:
            _stats["rejected_too_long"] += 1
            return False, f"Audio too long ({duration:.2f}s > {AUDIO_MAX_DURATION_SECONDS}s)"

    # Check for static/silence
    is_static, static_reason = detect_static_audio(audio_data)
    if is_static:
        _stats["rejected_static"] += 1
        return False, static_reason

    return True, "ok"


def detect_static_audio(audio_data: bytes) -> tuple[bool, str]:
    """
    Detect if audio is primarily static or silence.

    Uses RMS energy analysis to identify dead air.

    Returns:
        Tuple of (is_static, reason)
    """
    # Only analyze WAV files for now
    if not (audio_data[:4] == b'RIFF' and audio_data[8:12] == b'WAVE'):
        # For non-WAV, try pydub if available
        try:
            return _detect_static_pydub(audio_data)
        except Exception:
            return False, "ok"  # Can't analyze, assume valid

    return _calculate_wav_rms(audio_data)


def _calculate_wav_rms(audio_data: bytes) -> tuple[bool, str]:
    """
    Calculate RMS energy and silence ratio for WAV audio.

    Returns:
        Tuple of (is_static, reason)
    """
    try:
        if len(audio_data) < 44:
            return False, "ok"

        # Parse WAV header
        pos = 12
        sample_rate = 0
        num_channels = 1
        bits_per_sample = 16
        data_start = 0
        data_size = 0

        while pos < len(audio_data) - 8:
            chunk_id = audio_data[pos:pos+4]
            chunk_size = int.from_bytes(audio_data[pos+4:pos+8], 'little')

            if chunk_id == b'fmt ':
                num_channels = int.from_bytes(audio_data[pos+10:pos+12], 'little')
                sample_rate = int.from_bytes(audio_data[pos+12:pos+16], 'little')
                bits_per_sample = int.from_bytes(audio_data[pos+22:pos+24], 'little')
            elif chunk_id == b'data':
                data_start = pos + 8
                data_size = chunk_size
                break

            pos += 8 + chunk_size

        if data_start == 0 or sample_rate == 0:
            return False, "ok"

        # Analyze samples
        bytes_per_sample = bits_per_sample // 8
        frame_size = num_channels * bytes_per_sample

        if frame_size == 0:
            return False, "ok"

        num_frames = min(data_size // frame_size, sample_rate * 10)  # Max 10 seconds
        if num_frames < sample_rate // 10:  # Less than 0.1 seconds
            return False, "ok"

        # Calculate RMS
        sum_squares = 0
        silence_frames = 0
        silence_threshold = 500  # About -46dB

        for i in range(num_frames):
            frame_start = data_start + i * frame_size
            if frame_start + bytes_per_sample > len(audio_data):
                break

            if bytes_per_sample == 2:
                sample = int.from_bytes(
                    audio_data[frame_start:frame_start+2],
                    'little',
                    signed=True
                )
            else:
                sample = audio_data[frame_start] - 128
                sample *= 256

            sum_squares += sample * sample
            if abs(sample) < silence_threshold:
                silence_frames += 1

        rms = (sum_squares / num_frames) ** 0.5 if num_frames > 0 else 0
        silence_ratio = silence_frames / num_frames if num_frames > 0 else 1.0

        if rms < AUDIO_MIN_RMS_THRESHOLD:
            return True, f"Audio too quiet (RMS={rms:.0f} < {AUDIO_MIN_RMS_THRESHOLD})"

        if silence_ratio > AUDIO_SILENCE_RATIO_MAX:
            return True, f"Audio mostly silence ({silence_ratio*100:.0f}% > {AUDIO_SILENCE_RATIO_MAX*100:.0f}%)"

        return False, "ok"

    except Exception as e:
        logger.debug(f"RMS calculation error: {e}")
        return False, "ok"


def _detect_static_pydub(audio_data: bytes) -> tuple[bool, str]:
    """
    Detect static using pydub for non-WAV formats.

    Returns:
        Tuple of (is_static, reason)
    """
    try:
        from pydub import AudioSegment
        from pydub.silence import detect_silence

        audio = AudioSegment.from_file(io.BytesIO(audio_data))

        # Calculate RMS
        rms = audio.rms
        if rms < AUDIO_MIN_RMS_THRESHOLD:
            return True, f"Audio too quiet (RMS={rms} < {AUDIO_MIN_RMS_THRESHOLD})"

        # Detect silence ratio
        silence_ranges = detect_silence(audio, min_silence_len=100, silence_thresh=-45)
        total_silence_ms = sum(end - start for start, end in silence_ranges)
        silence_ratio = total_silence_ms / len(audio) if len(audio) > 0 else 1.0

        if silence_ratio > AUDIO_SILENCE_RATIO_MAX:
            return True, f"Audio mostly silence ({silence_ratio*100:.0f}%)"

        return False, "ok"

    except ImportError:
        return False, "ok"
    except Exception as e:
        logger.debug(f"Pydub analysis error: {e}")
        return False, "ok"


def get_audio_url(transmission: AudioTransmission, signed: bool = True) -> Optional[str]:
    """
    Get accessible URL for an audio file (S3 signed URL or local API URL).

    Args:
        transmission: AudioTransmission instance
        signed: Whether to generate a signed URL for S3

    Returns:
        Accessible URL for the audio file
    """
    if transmission.s3_key and settings.S3_ENABLED:
        if signed:
            return generate_signed_url(
                transmission.filename,
                settings.RADIO_S3_PREFIX,
                expires_in=3600
            )
        else:
            from skyspy.services.storage import get_s3_url
            return get_s3_url(transmission.filename, settings.RADIO_S3_PREFIX)
    else:
        return f"/api/v1/audio/file/{transmission.filename}"


def create_transmission(
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
    safe_filename = sanitize_filename(filename)

    if len(safe_filename) > 255:
        raise ValueError("Filename exceeds maximum length")

    if channel_name and len(channel_name) > 100:
        raise ValueError("Channel name exceeds maximum length")

    if frequency_mhz is not None and not (118.0 <= frequency_mhz <= 137.0):
        raise ValueError("Frequency must be in valid airband range (118.0-137.0 MHz)")

    # Determine format
    file_ext = Path(safe_filename).suffix.lower().lstrip(".")
    audio_format = file_ext if file_ext in ("mp3", "wav", "ogg", "flac") else "mp3"

    # Calculate duration if not provided
    if duration_seconds is None or duration_seconds == 0:
        calculated_duration = get_audio_duration(audio_data)
        if calculated_duration:
            duration_seconds = calculated_duration

    # Check audio quality if transcription is requested
    if queue_transcription:
        is_valid, rejection_reason = check_audio_quality(audio_data, duration_seconds)
        if not is_valid:
            logger.info(f"Audio rejected for transcription: {rejection_reason}")
            queue_transcription = False  # Still save, but don't transcribe

    # Upload to S3 or save locally
    s3_url = None
    s3_key = None

    if settings.S3_ENABLED:
        content_type = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "ogg": "audio/ogg",
            "flac": "audio/flac",
        }.get(audio_format, "audio/mpeg")

        s3_url = upload_to_s3(
            audio_data,
            safe_filename,
            settings.RADIO_S3_PREFIX,
            content_type=content_type
        )
        if s3_url:
            s3_key = get_s3_key(safe_filename, settings.RADIO_S3_PREFIX)
            _stats["uploads"] += 1
        else:
            _stats["upload_errors"] += 1
    else:
        save_file_locally(audio_data, safe_filename, settings.RADIO_AUDIO_DIR)
        _stats["uploads"] += 1

    # Create database record
    transmission = AudioTransmission.objects.create(
        filename=safe_filename,
        s3_key=s3_key,
        s3_url=s3_url,
        file_size_bytes=len(audio_data),
        duration_seconds=duration_seconds,
        format=audio_format,
        frequency_mhz=frequency_mhz,
        channel_name=channel_name,
        transcription_status="pending",
        metadata=metadata or {},
    )

    logger.info(f"Created audio transmission {transmission.id}: {safe_filename}")

    # Queue for transcription
    if queue_transcription and (settings.TRANSCRIPTION_ENABLED or settings.WHISPER_ENABLED):
        transmission.transcription_status = "queued"
        transmission.transcription_queued_at = timezone.now()
        transmission.save()
        _stats["transcriptions_queued"] += 1

    return transmission


def process_transcription(transmission: AudioTransmission) -> bool:
    """
    Process a transcription job synchronously.

    Args:
        transmission: AudioTransmission to transcribe

    Returns:
        True if transcription succeeded
    """
    has_transcription = (
        settings.WHISPER_ENABLED
        or settings.TRANSCRIPTION_ENABLED
        or settings.ATC_WHISPER_ENABLED
    )
    if not has_transcription:
        logger.error("No transcription service configured")
        return False

    transmission.transcription_status = "processing"
    transmission.transcription_started_at = timezone.now()
    transmission.save()

    try:
        # Fetch audio data
        if transmission.s3_key and settings.S3_ENABLED:
            audio_data = download_from_s3(
                transmission.filename,
                settings.RADIO_S3_PREFIX
            )
        else:
            audio_data = read_local_file(
                transmission.filename,
                settings.RADIO_AUDIO_DIR
            )

        if not audio_data:
            raise ValueError("Failed to fetch audio data")

        # Call transcription service
        if settings.WHISPER_ENABLED:
            result_data = _transcribe_with_whisper(audio_data, transmission.filename)
        elif settings.ATC_WHISPER_ENABLED:
            result_data = _transcribe_with_atc_whisper(audio_data, transmission.filename)
        else:
            result_data = _transcribe_with_external_service(audio_data, transmission.filename)

        # Update with transcription result
        transcript_text = result_data.get("text", "")
        transmission.transcription_status = "completed"
        transmission.transcription_completed_at = timezone.now()
        transmission.transcript = transcript_text
        transmission.transcript_confidence = result_data.get("confidence")
        transmission.transcript_language = result_data.get("language", "en")
        transmission.transcript_segments = result_data.get("segments")

        # Identify airframes
        if transcript_text:
            identified = identify_airframes_from_transcript(
                transcript_text,
                segments=result_data.get("segments"),
                duration_seconds=transmission.duration_seconds,
            )
            if identified:
                transmission.identified_airframes = identified

        transmission.save()
        _stats["transcriptions_completed"] += 1
        logger.info(f"Transcription completed for {transmission.id}")

        # Broadcast transcription completion via WebSocket
        _broadcast_transcription_event(transmission, "completed")

        return True

    except Exception as e:
        transmission.transcription_status = "failed"
        transmission.transcription_error = str(e)
        transmission.save()
        _stats["transcriptions_failed"] += 1
        logger.error(f"Transcription failed for {transmission.id}: {e}")

        # Broadcast failure event
        _broadcast_transcription_event(transmission, "failed", error=str(e))

        return False


def _transcribe_with_whisper(audio_data: bytes, filename: str) -> dict:
    """Transcribe audio using local Whisper service."""
    whisper_url = f"{settings.WHISPER_URL}/asr"

    ext = Path(filename).suffix.lower().lstrip(".")
    content_type = {
        "mp3": "audio/mpeg", "wav": "audio/wav",
        "ogg": "audio/ogg", "flac": "audio/flac",
    }.get(ext, "audio/mpeg")

    files = {"audio_file": (filename, audio_data, content_type)}
    params = {
        "task": "transcribe",
        "language": "en",
        "output": "json",
        "initial_prompt": ATC_WHISPER_PROMPT,  # ATC domain prompt
    }

    with httpx.Client(timeout=120.0) as client:
        response = client.post(whisper_url, params=params, files=files)
        response.raise_for_status()
        return response.json()


def _transcribe_with_external_service(audio_data: bytes, filename: str) -> dict:
    """Transcribe audio using external service (OpenAI-compatible)."""
    ext = Path(filename).suffix.lower().lstrip(".")
    content_type = {
        "mp3": "audio/mpeg", "wav": "audio/wav",
        "ogg": "audio/ogg", "flac": "audio/flac",
    }.get(ext, "audio/mpeg")

    base_url = settings.TRANSCRIPTION_SERVICE_URL.rstrip("/")
    if not base_url.endswith("/v1/audio/transcriptions"):
        if base_url.endswith("/v1"):
            endpoint = f"{base_url}/audio/transcriptions"
        else:
            endpoint = f"{base_url}/v1/audio/transcriptions"
    else:
        endpoint = base_url

    files = {"file": (filename, audio_data, content_type)}
    data = {
        "model": settings.TRANSCRIPTION_MODEL or "Systran/faster-whisper-small.en",
        "language": "en",
        "prompt": ATC_WHISPER_PROMPT,  # ATC domain prompt for better accuracy
    }

    headers = {}
    if settings.TRANSCRIPTION_API_KEY:
        headers["Authorization"] = f"Bearer {settings.TRANSCRIPTION_API_KEY}"

    with httpx.Client(timeout=120.0) as client:
        response = client.post(endpoint, files=files, data=data, headers=headers)
        response.raise_for_status()
        return response.json()


def _transcribe_with_atc_whisper(audio_data: bytes, filename: str) -> dict:
    """Transcribe audio using atc-whisper library."""
    try:
        from atc_whisper import ATCTranscriber, TranscriptionConfig, PreprocessConfig, VADConfig
    except ImportError as e:
        logger.error(f"atc-whisper not installed: {e}")
        raise ValueError("atc-whisper library not available") from e

    import tempfile
    import os

    base_url = settings.TRANSCRIPTION_SERVICE_URL.rstrip("/")
    if base_url.endswith("/v1/audio/transcriptions"):
        base_url = base_url[:-len("/audio/transcriptions")]

    config = TranscriptionConfig(
        base_url=base_url,
        model=settings.TRANSCRIPTION_MODEL or "large-v3",
        language="en",
        max_concurrent=settings.ATC_WHISPER_MAX_CONCURRENT,
        initial_prompt=ATC_WHISPER_PROMPT,  # ATC domain prompt
    )

    preprocess_config = PreprocessConfig(noise_reduce=settings.ATC_WHISPER_NOISE_REDUCE)
    vad_config = VADConfig(aggressiveness=2, min_speech_ms=200, min_silence_ms=300)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        # Note: ATCTranscriber is async, need to run in event loop
        import asyncio
        import concurrent.futures

        async def run_transcription():
            async with ATCTranscriber(config, preprocess_config, vad_config) as transcriber:
                return await transcriber.transcribe_file(
                    tmp_path,
                    segment_by_vad=settings.ATC_WHISPER_SEGMENT_BY_VAD
                )

        # Handle case where we might already be in an async context
        # (e.g., called from async Celery task or async view)
        try:
            asyncio.get_running_loop()
            # Already in async context - run in a new thread with its own event loop
            def _run_in_new_loop():
                return asyncio.run(run_transcription())

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                result = pool.submit(_run_in_new_loop).result()
        except RuntimeError:
            # No running loop, safe to use asyncio.run() directly
            result = asyncio.run(run_transcription())

        return {
            "text": result.text if hasattr(result, 'text') else result.full_text,
            "segments": getattr(result, 'segments', []),
            "language": "en",
            "duration": getattr(result, 'duration_seconds', None),
        }

    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError as e:
                logger.debug(f"Failed to cleanup temp file {tmp_path}: {e}")


def get_matched_radio_calls(
    callsign: Optional[str] = None,
    operator_icao: Optional[str] = None,
    registration: Optional[str] = None,
    hours: int = 24,
    limit: int = 10,
) -> list[dict]:
    """
    Get audio transmissions that mention a specific aircraft.

    Args:
        callsign: Flight callsign to match (e.g., "UAL123")
        operator_icao: Operator ICAO code (e.g., "UAL")
        registration: Aircraft registration (e.g., "N12345")
        hours: How many hours back to search
        limit: Maximum number of results

    Returns:
        List of matched radio call dicts
    """
    from datetime import timedelta

    if not callsign and not operator_icao and not registration:
        return []

    cutoff = timezone.now() - timedelta(hours=hours)

    transmissions = AudioTransmission.objects.filter(
        transcription_status="completed",
        identified_airframes__isnull=False,
        created_at__gte=cutoff
    ).order_by('-created_at')

    matched_calls = []

    for tx in transmissions:
        if not tx.identified_airframes:
            continue

        for airframe in tx.identified_airframes:
            af_callsign = airframe.get("callsign", "")
            af_airline_icao = airframe.get("airline_icao", "")
            af_type = airframe.get("type", "")

            matched = False

            if callsign and af_callsign.upper() == callsign.upper():
                matched = True
            elif operator_icao and af_airline_icao.upper() == operator_icao.upper():
                matched = True
            elif registration and af_type == "general_aviation":
                if af_callsign.upper() == registration.upper():
                    matched = True

            if matched:
                audio_url = get_audio_url(tx, signed=True)
                matched_calls.append({
                    "id": tx.id,
                    "created_at": tx.created_at.isoformat() + "Z" if tx.created_at else None,
                    "transcript": tx.transcript,
                    "frequency_mhz": tx.frequency_mhz,
                    "channel_name": tx.channel_name,
                    "duration_seconds": tx.duration_seconds,
                    "confidence": airframe.get("confidence", 0.5),
                    "raw_text": airframe.get("raw_text", ""),
                    "audio_url": audio_url,
                    "matched_callsign": af_callsign,
                })
                break

        if len(matched_calls) >= limit:
            break

    return matched_calls


def get_audio_stats() -> dict:
    """Get audio transmission statistics."""
    from django.db.models import Count, Sum

    by_status = dict(
        AudioTransmission.objects.values_list('transcription_status')
        .annotate(count=Count('id'))
    )

    totals = AudioTransmission.objects.aggregate(
        total_duration=Sum('duration_seconds'),
        total_size=Sum('file_size_bytes'),
    )

    by_channel = dict(
        AudioTransmission.objects.exclude(channel_name__isnull=True)
        .values_list('channel_name')
        .annotate(count=Count('id'))
    )

    total_count = AudioTransmission.objects.count()

    return {
        "total_transmissions": total_count,
        "total_transcribed": by_status.get("completed", 0),
        "pending_transcription": by_status.get("pending", 0) + by_status.get("queued", 0),
        "failed_transcription": by_status.get("failed", 0),
        "total_duration_hours": round((totals['total_duration'] or 0) / 3600, 2),
        "total_size_mb": round((totals['total_size'] or 0) / (1024 * 1024), 2),
        "by_channel": by_channel,
        "by_status": by_status,
        "service_stats": _stats.copy(),
    }


def get_service_stats() -> dict:
    """Get service-level statistics."""
    transcription_enabled = (
        settings.TRANSCRIPTION_ENABLED
        or settings.WHISPER_ENABLED
        or settings.ATC_WHISPER_ENABLED
    )
    return {
        "radio_enabled": settings.RADIO_ENABLED,
        "radio_audio_dir": settings.RADIO_AUDIO_DIR,
        "transcription_enabled": transcription_enabled,
        "whisper_enabled": settings.WHISPER_ENABLED,
        "atc_whisper_enabled": settings.ATC_WHISPER_ENABLED,
        "atc_whisper_vad": settings.ATC_WHISPER_SEGMENT_BY_VAD,
        "s3_enabled": settings.S3_ENABLED,
        "s3_prefix": settings.RADIO_S3_PREFIX,
        **_stats,
    }


def _broadcast_transcription_event(
    transmission: AudioTransmission,
    status: str,
    error: Optional[str] = None
):
    """
    Broadcast transcription status update via WebSocket.

    Args:
        transmission: The AudioTransmission record
        status: Event status ("completed", "failed", "processing")
        error: Optional error message for failures
    """
    try:
        from channels.layers import get_channel_layer
        from skyspy.utils import sync_group_send

        channel_layer = get_channel_layer()
        if not channel_layer:
            return

        event_data = {
            "id": transmission.id,
            "filename": transmission.filename,
            "status": status,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

        if status == "completed":
            event_data.update({
                "transcript": transmission.transcript,
                "confidence": transmission.transcript_confidence,
                "language": transmission.transcript_language,
                "duration_seconds": transmission.duration_seconds,
                "frequency_mhz": transmission.frequency_mhz,
                "channel_name": transmission.channel_name,
                "identified_airframes": transmission.identified_airframes,
                "audio_url": get_audio_url(transmission),
            })
        elif status == "failed" and error:
            event_data["error"] = error

        sync_group_send(
            channel_layer,
            'audio_transmissions',
            {
                'type': 'audio_transmission',
                'data': event_data
            }
        )

        logger.debug(f"Broadcast transcription event: {status} for {transmission.id}")

    except Exception as e:
        logger.warning(f"Failed to broadcast transcription event: {e}")


def broadcast_new_transmission(transmission: AudioTransmission):
    """
    Broadcast notification of a new audio transmission.

    Call this after creating a new transmission record.
    """
    try:
        from channels.layers import get_channel_layer
        from skyspy.utils import sync_group_send

        channel_layer = get_channel_layer()
        if not channel_layer:
            return

        event_data = {
            "id": transmission.id,
            "filename": transmission.filename,
            "status": "new",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "duration_seconds": transmission.duration_seconds,
            "frequency_mhz": transmission.frequency_mhz,
            "channel_name": transmission.channel_name,
            "transcription_status": transmission.transcription_status,
        }

        sync_group_send(
            channel_layer,
            'audio_transmissions',
            {
                'type': 'audio_transmission',
                'data': event_data
            }
        )

    except Exception as e:
        logger.warning(f"Failed to broadcast new transmission: {e}")
