"""
Military aircraft database service.

Provides identification of military aircraft based on:
- ICAO hex code ranges
- Callsign patterns
- Aircraft type codes

This service enhances aircraft identification beyond standard databases.
"""
import logging
import re
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger(__name__)

# Military ICAO hex ranges by country
# Format: (start, end, country, service)
MILITARY_HEX_RANGES: List[Tuple[int, int, str, str]] = [
    # United States
    (0xADF7C7, 0xAFFFFF, 'USA', 'US Military'),
    (0xAE0000, 0xAFFFFF, 'USA', 'US Air Force'),

    # United Kingdom
    (0x43C000, 0x43CFFF, 'UK', 'Royal Air Force'),

    # Germany
    (0x3F4000, 0x3F7FFF, 'Germany', 'German Air Force'),

    # France
    (0x3B0000, 0x3BFFFF, 'France', 'French Air Force'),

    # Australia
    (0x7C0000, 0x7FFFFF, 'Australia', 'Australian Military'),

    # Canada
    (0xC00000, 0xC3FFFF, 'Canada', 'Canadian Armed Forces'),

    # NATO AWACS
    (0x478100, 0x4781FF, 'NATO', 'NATO AWACS'),

    # Russia
    (0x140000, 0x15FFFF, 'Russia', 'Russian Air Force'),

    # China
    (0x780000, 0x7BFFFF, 'China', 'Chinese Air Force'),
]

# Military callsign patterns
# Format: (regex pattern, description, unit/mission type)
MILITARY_CALLSIGN_PATTERNS: List[Tuple[str, str, str]] = [
    # US Air Force
    (r'^EVAC\d+$', 'US Air Force', 'Medical Evacuation'),
    (r'^RCH\d+$', 'US Air Force', 'Air Mobility Command'),
    (r'^REACH\d+$', 'US Air Force', 'Air Mobility Command'),
    (r'^STEEL\d+$', 'US Air Force', 'Tanker'),
    (r'^SHELL\d+$', 'US Air Force', 'Tanker'),
    (r'^ETHYL\d+$', 'US Air Force', 'Tanker'),
    (r'^ARCT\d+$', 'US Air Force', 'Arctic Operations'),
    (r'^SPAR\d+$', 'US Government', 'VIP Transport'),
    (r'^SAM\d+$', 'US Government', 'Special Air Mission'),
    (r'^EXEC\d+$', 'US Government', 'Executive Transport'),
    (r'^NIGHT\d+$', 'US Air Force', 'Night Operations'),
    (r'^VIPER\d+$', 'US Air Force', 'Fighter'),
    (r'^RAPTOR\d+$', 'US Air Force', 'F-22'),
    (r'^TREND\d+$', 'US Air Force', 'Reconnaissance'),
    (r'^REDEYE\d+$', 'US Air Force', 'Intelligence'),
    (r'^COBRA\d+$', 'US Army', 'Attack Helicopter'),
    (r'^DUSTOFF\d+$', 'US Army', 'Medical Evacuation'),

    # US Navy
    (r'^NAVY\d+$', 'US Navy', 'Navy Flight'),
    (r'^TOPCAT\d+$', 'US Navy', 'Carrier Operations'),
    (r'^CONDOR\d+$', 'US Navy', 'P-8 Poseidon'),

    # US Coast Guard
    (r'^CGNR\d+$', 'US Coast Guard', 'Coast Guard'),
    (r'^USCG\d+$', 'US Coast Guard', 'Coast Guard'),
    (r'^RESCUE\d+$', 'US Coast Guard', 'Search and Rescue'),

    # UK RAF
    (r'^RRR\d+$', 'Royal Air Force', 'RAF Flight'),
    (r'^ASCOT\d+$', 'Royal Air Force', 'RAF Transport'),
    (r'^TARTAN\d+$', 'Royal Air Force', 'Scottish Units'),

    # NATO
    (r'^NATO\d+$', 'NATO', 'NATO Operations'),
    (r'^AWACS\d+$', 'NATO', 'AWACS'),
    (r'^MAGIC\d+$', 'NATO', 'AWACS E-3'),

    # German
    (r'^GAF\d+$', 'German Air Force', 'Luftwaffe'),
    (r'^DCN\d+$', 'German Navy', 'Marine'),

    # French
    (r'^CTM\d+$', 'French Air Force', 'French Military'),
    (r'^FAF\d+$', 'French Air Force', 'Armee de l\'Air'),

    # Canadian
    (r'^CFC\d+$', 'Canadian Forces', 'Canadian Military'),

    # Australian
    (r'^RAAF\d+$', 'Royal Australian Air Force', 'RAAF'),

    # Generic military patterns
    (r'^DRAGN\d+$', 'Military', 'Fighter'),
    (r'^HAWK\d+$', 'Military', 'Fighter/Attack'),
    (r'^EAGLE\d+$', 'Military', 'Fighter'),
    (r'^TIGER\d+$', 'Military', 'Fighter'),
    (r'^WOLF\d+$', 'Military', 'Special Operations'),
    (r'^DEMON\d+$', 'Military', 'Fighter'),
    (r'^SHADOW\d+$', 'Military', 'Reconnaissance'),
    (r'^STORM\d+$', 'Military', 'Strike'),
    (r'^THUNDER\d+$', 'Military', 'Strike'),
    (r'^IRON\d+$', 'Military', 'Heavy Lift'),
    (r'^HEAVY\d+$', 'Military', 'Heavy Lift'),
    (r'^GIANT\d+$', 'Military', 'Strategic Airlift'),
]

# Military aircraft type codes
MILITARY_AIRCRAFT_TYPES: Dict[str, Dict[str, str]] = {
    # Fighters
    'F16': {'name': 'F-16 Fighting Falcon', 'role': 'Multirole Fighter'},
    'F15': {'name': 'F-15 Eagle', 'role': 'Air Superiority Fighter'},
    'F15E': {'name': 'F-15E Strike Eagle', 'role': 'Strike Fighter'},
    'F18': {'name': 'F/A-18 Hornet', 'role': 'Multirole Fighter'},
    'F18E': {'name': 'F/A-18E Super Hornet', 'role': 'Multirole Fighter'},
    'F22': {'name': 'F-22 Raptor', 'role': 'Stealth Air Superiority'},
    'F35': {'name': 'F-35 Lightning II', 'role': 'Stealth Multirole'},
    'F35A': {'name': 'F-35A Lightning II', 'role': 'Stealth Multirole (CTOL)'},
    'F35B': {'name': 'F-35B Lightning II', 'role': 'Stealth Multirole (STOVL)'},
    'F35C': {'name': 'F-35C Lightning II', 'role': 'Stealth Multirole (Carrier)'},
    'EUFI': {'name': 'Eurofighter Typhoon', 'role': 'Multirole Fighter'},
    'RFAL': {'name': 'Dassault Rafale', 'role': 'Multirole Fighter'},

    # Bombers
    'B1': {'name': 'B-1B Lancer', 'role': 'Strategic Bomber'},
    'B2': {'name': 'B-2 Spirit', 'role': 'Stealth Bomber'},
    'B52': {'name': 'B-52 Stratofortress', 'role': 'Strategic Bomber'},

    # Tankers
    'KC10': {'name': 'KC-10 Extender', 'role': 'Aerial Refueling'},
    'KC135': {'name': 'KC-135 Stratotanker', 'role': 'Aerial Refueling'},
    'KC46': {'name': 'KC-46 Pegasus', 'role': 'Aerial Refueling'},
    'A330M': {'name': 'A330 MRTT', 'role': 'Multi-Role Tanker Transport'},
    'K35A': {'name': 'KC-135A Stratotanker', 'role': 'Aerial Refueling'},
    'K35R': {'name': 'KC-135R Stratotanker', 'role': 'Aerial Refueling'},

    # Transports
    'C17': {'name': 'C-17 Globemaster III', 'role': 'Strategic Airlifter'},
    'C5': {'name': 'C-5 Galaxy', 'role': 'Strategic Airlifter'},
    'C130': {'name': 'C-130 Hercules', 'role': 'Tactical Airlifter'},
    'C130J': {'name': 'C-130J Super Hercules', 'role': 'Tactical Airlifter'},
    'C27J': {'name': 'C-27J Spartan', 'role': 'Tactical Airlifter'},
    'C40': {'name': 'C-40 Clipper', 'role': 'VIP Transport'},
    'C32': {'name': 'C-32 (Boeing 757)', 'role': 'VIP Transport'},
    'C37': {'name': 'C-37 Gulfstream', 'role': 'VIP Transport'},
    'VC25': {'name': 'VC-25 (Air Force One)', 'role': 'Presidential Transport'},
    'A400': {'name': 'Airbus A400M Atlas', 'role': 'Tactical/Strategic Airlifter'},

    # AWACS / Surveillance
    'E3': {'name': 'E-3 Sentry', 'role': 'Airborne Early Warning'},
    'E3CF': {'name': 'E-3 Sentry (French)', 'role': 'Airborne Early Warning'},
    'E7A': {'name': 'E-7A Wedgetail', 'role': 'Airborne Early Warning'},
    'E8': {'name': 'E-8 Joint STARS', 'role': 'Battle Management'},
    'RC135': {'name': 'RC-135', 'role': 'Reconnaissance'},
    'U2': {'name': 'U-2 Dragon Lady', 'role': 'High-Altitude Reconnaissance'},
    'GLEX': {'name': 'Global Express', 'role': 'Reconnaissance/VIP'},
    'RQ4': {'name': 'RQ-4 Global Hawk', 'role': 'UAV Reconnaissance'},
    'MQ9': {'name': 'MQ-9 Reaper', 'role': 'UAV Strike/Reconnaissance'},
    'P8': {'name': 'P-8 Poseidon', 'role': 'Maritime Patrol'},

    # Helicopters
    'H60': {'name': 'H-60 Black Hawk', 'role': 'Utility Helicopter'},
    'UH60': {'name': 'UH-60 Black Hawk', 'role': 'Utility Helicopter'},
    'CH47': {'name': 'CH-47 Chinook', 'role': 'Heavy Lift Helicopter'},
    'AH64': {'name': 'AH-64 Apache', 'role': 'Attack Helicopter'},
    'V22': {'name': 'V-22 Osprey', 'role': 'Tiltrotor'},
}

# Interesting/special aircraft categories
INTERESTING_CATEGORIES: Dict[str, List[str]] = {
    'government_vip': [
        'VC25', 'C32', 'C40', 'C37', 'GLEX',
    ],
    'military_special': [
        'E3', 'E4', 'E6', 'E7A', 'E8', 'RC135', 'U2', 'P8',
    ],
    'stealth': [
        'F22', 'F35', 'F35A', 'F35B', 'F35C', 'B2',
    ],
}


def identify_military_by_hex(icao_hex: str) -> Optional[Dict[str, Any]]:
    """
    Identify military aircraft by ICAO hex code.

    Args:
        icao_hex: Aircraft ICAO hex code (e.g., 'AE1234')

    Returns:
        Military identification dictionary or None if not military
    """
    if not icao_hex:
        return None

    try:
        hex_int = int(icao_hex, 16)

        for start, end, country, service in MILITARY_HEX_RANGES:
            if start <= hex_int <= end:
                return {
                    'is_military': True,
                    'country': country,
                    'service': service,
                    'source': 'hex_range',
                }

    except ValueError:
        pass

    return None


def identify_military_by_callsign(callsign: str) -> Optional[Dict[str, Any]]:
    """
    Identify military aircraft by callsign pattern.

    Args:
        callsign: Aircraft callsign (e.g., 'RCH123')

    Returns:
        Military identification dictionary or None if not matched
    """
    if not callsign:
        return None

    callsign_upper = callsign.upper().strip()

    for pattern, service, mission in MILITARY_CALLSIGN_PATTERNS:
        if re.match(pattern, callsign_upper):
            return {
                'is_military': True,
                'service': service,
                'mission_type': mission,
                'source': 'callsign_pattern',
            }

    return None


def get_military_aircraft_type(type_code: str) -> Optional[Dict[str, Any]]:
    """
    Get military aircraft type information.

    Args:
        type_code: Aircraft type ICAO code

    Returns:
        Aircraft type information dictionary or None if not found
    """
    if not type_code:
        return None

    type_upper = type_code.upper().strip()

    if type_upper in MILITARY_AIRCRAFT_TYPES:
        info = MILITARY_AIRCRAFT_TYPES[type_upper]
        return {
            'type_code': type_upper,
            'name': info['name'],
            'role': info['role'],
            'is_military': True,
        }

    return None


def identify_aircraft(
    icao_hex: Optional[str] = None,
    callsign: Optional[str] = None,
    type_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Comprehensive military aircraft identification.

    Checks all available identifiers to determine if aircraft is military
    and provide additional information.

    Args:
        icao_hex: Aircraft ICAO hex code
        callsign: Aircraft callsign
        type_code: Aircraft type code

    Returns:
        Identification result dictionary
    """
    result = {
        'is_military': False,
        'confidence': 'none',
        'identifiers': [],
    }

    # Check hex range
    hex_result = identify_military_by_hex(icao_hex)
    if hex_result:
        result['is_military'] = True
        result['confidence'] = 'high'
        result['country'] = hex_result.get('country')
        result['service'] = hex_result.get('service')
        result['identifiers'].append('hex_range')

    # Check callsign pattern
    callsign_result = identify_military_by_callsign(callsign)
    if callsign_result:
        result['is_military'] = True
        if result['confidence'] == 'none':
            result['confidence'] = 'medium'
        elif result['confidence'] == 'high':
            result['confidence'] = 'very_high'
        result['service'] = callsign_result.get('service', result.get('service'))
        result['mission_type'] = callsign_result.get('mission_type')
        result['identifiers'].append('callsign_pattern')

    # Check aircraft type
    type_result = get_military_aircraft_type(type_code)
    if type_result:
        result['is_military'] = True
        if result['confidence'] == 'none':
            result['confidence'] = 'medium'
        result['aircraft_name'] = type_result.get('name')
        result['aircraft_role'] = type_result.get('role')
        result['identifiers'].append('aircraft_type')

    return result


def get_interesting_category(type_code: Optional[str]) -> Optional[str]:
    """
    Get interesting aircraft category if applicable.

    Args:
        type_code: Aircraft type code

    Returns:
        Category name or None
    """
    if not type_code:
        return None

    type_upper = type_code.upper().strip()

    for category, types in INTERESTING_CATEGORIES.items():
        if type_upper in types:
            return category

    return None


def get_all_military_patterns() -> Dict[str, Any]:
    """
    Get all configured military identification patterns.

    Returns:
        Dictionary with all patterns for reference
    """
    return {
        'hex_ranges': [
            {
                'start': f"{start:06X}",
                'end': f"{end:06X}",
                'country': country,
                'service': service,
            }
            for start, end, country, service in MILITARY_HEX_RANGES
        ],
        'callsign_patterns': [
            {
                'pattern': pattern,
                'service': service,
                'mission': mission,
            }
            for pattern, service, mission in MILITARY_CALLSIGN_PATTERNS
        ],
        'aircraft_types': MILITARY_AIRCRAFT_TYPES,
        'interesting_categories': INTERESTING_CATEGORIES,
    }
