"""
Law enforcement aircraft detection service.

Identifies law enforcement, federal, and surveillance aircraft based on:
- Callsign patterns
- Operator ICAO codes
- Aircraft type codes

This service helps identify potential law enforcement activity for situational awareness.
"""
import logging
import re
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger(__name__)

# Law enforcement callsign patterns
# Format: (regex pattern, category, description)
LAW_ENFORCEMENT_CALLSIGN_PATTERNS: List[Tuple[str, str, str]] = [
    # Police helicopters - specific agencies
    (r'^N(PAS|POL)\d*', 'Police Aviation', 'Police Air Support'),
    (r'^CHP\d*', 'Police Aviation', 'California Highway Patrol'),
    (r'^LAPD\d*', 'Police Aviation', 'Los Angeles Police Dept'),
    (r'^NYPD\d*', 'Police Aviation', 'New York Police Dept'),
    (r'^SFPD\d*', 'Police Aviation', 'San Francisco Police Dept'),
    (r'^CPD\d*', 'Police Aviation', 'Chicago Police Dept'),
    (r'^HPD\d*', 'Police Aviation', 'Houston Police Dept'),
    (r'^MPD\d*', 'Police Aviation', 'Metropolitan Police Dept'),
    (r'^LVMPD\d*', 'Police Aviation', 'Las Vegas Metro Police'),
    (r'^MCSO\d*', 'Police Aviation', 'Maricopa County Sheriff'),
    (r'^BCSO\d*', 'Police Aviation', 'County Sheriff Office'),
    (r'^PCSO\d*', 'Police Aviation', 'County Sheriff Office'),

    # Generic police patterns
    (r'^POLICE\d*', 'Police Aviation', 'Police'),
    (r'^COPTER\d*', 'Police Aviation', 'Police Helicopter'),
    (r'^SHERIFF\d*', 'Police Aviation', 'Sheriff'),
    (r'^ASO\d*', 'Police Aviation', 'Air Support Operations'),
    (r'^UNIT\d+', 'Police Aviation', 'Police Unit'),

    # Federal agencies
    (r'^CBP\d*', 'Federal Law Enforcement', 'Customs & Border Protection'),
    (r'^OMAHA\d*', 'Federal Law Enforcement', 'CBP Air & Marine'),
    (r'^BORDER\d*', 'Federal Law Enforcement', 'Border Patrol'),
    (r'^USMS\d*', 'Federal Law Enforcement', 'US Marshals Service'),
    (r'^JPATS\d*', 'Federal Law Enforcement', 'Justice Prisoner & Alien Transport'),
    (r'^ICE\d*', 'Federal Law Enforcement', 'Immigration & Customs Enforcement'),
    (r'^DEA\d*', 'Federal Law Enforcement', 'Drug Enforcement Admin'),
    (r'^ATF\d*', 'Federal Law Enforcement', 'Bureau of Alcohol Tobacco Firearms'),
    (r'^FBI\d*', 'Federal Law Enforcement', 'Federal Bureau of Investigation'),
    (r'^DHS\d*', 'Federal Law Enforcement', 'Dept of Homeland Security'),

    # State patrol patterns
    (r'^TROOPER\d*', 'State Police', 'State Trooper'),
    (r'^PATROL\d*', 'State Police', 'State Patrol'),
    (r'^STATE\d*', 'State Police', 'State Police'),
    (r'^THP\d*', 'State Police', 'Tennessee Highway Patrol'),
    (r'^OHP\d*', 'State Police', 'Oklahoma Highway Patrol'),
    (r'^WSP\d*', 'State Police', 'Washington State Patrol'),
    (r'^FHP\d*', 'State Police', 'Florida Highway Patrol'),
    (r'^ISP\d*', 'State Police', 'Illinois State Police'),
    (r'^OSP\d*', 'State Police', 'Oregon State Police'),
    (r'^PSP\d*', 'State Police', 'Pennsylvania State Police'),
    (r'^NYSP\d*', 'State Police', 'New York State Police'),
    (r'^MSP\d*', 'State Police', 'Michigan/Maryland State Police'),

    # News helicopters (often follow enforcement activity)
    (r'^NEWS\d+', 'News Media', 'News Helicopter'),
    (r'^CHOPPER\d+', 'News Media', 'News Helicopter'),
    (r'^SKY\d+', 'News Media', 'Sky News'),
    (r'^KOMO\d*', 'News Media', 'KOMO News'),
    (r'^KIRO\d*', 'News Media', 'KIRO News'),
    (r'^KTLA\d*', 'News Media', 'KTLA News'),
    (r'^KABC\d*', 'News Media', 'KABC News'),
    (r'^KCBS\d*', 'News Media', 'KCBS News'),
    (r'^KNBC\d*', 'News Media', 'KNBC News'),
    (r'^WABC\d*', 'News Media', 'WABC News'),
    (r'^WCBS\d*', 'News Media', 'WCBS News'),
    (r'^WNBC\d*', 'News Media', 'WNBC News'),
    (r'^WFLA\d*', 'News Media', 'WFLA News'),
    (r'^WSVN\d*', 'News Media', 'WSVN News'),

    # Medical/emergency (not law enforcement but important)
    (r'^LIFEFLT\d*', 'Medical', 'Life Flight'),
    (r'^LIFESTAR\d*', 'Medical', 'Life Star'),
    (r'^MEDEVAC\d*', 'Medical', 'Medical Evacuation'),
    (r'^MEDIC\d*', 'Medical', 'Medical'),
    (r'^MERCY\d*', 'Medical', 'Mercy Flight'),
    (r'^LIFEGUARD\d*', 'Medical', 'LifeGuard'),
]

# Law enforcement operator ICAO codes
LAW_ENFORCEMENT_OPERATORS: Dict[str, Tuple[str, str]] = {
    # US Federal
    'CBP': ('Federal Law Enforcement', 'Customs & Border Protection'),
    'DHS': ('Federal Law Enforcement', 'Dept of Homeland Security'),
    'USMS': ('Federal Law Enforcement', 'US Marshals Service'),
    'ICE': ('Federal Law Enforcement', 'Immigration & Customs Enforcement'),
    'DEA': ('Federal Law Enforcement', 'Drug Enforcement Admin'),
    'ATF': ('Federal Law Enforcement', 'Bureau of Alcohol Tobacco Firearms'),
    'FBI': ('Federal Law Enforcement', 'Federal Bureau of Investigation'),
    'DOJ': ('Federal Law Enforcement', 'Dept of Justice'),

    # US State/Local (examples - operators vary)
    'CHP': ('State Police', 'California Highway Patrol'),
    'LAPD': ('Police Aviation', 'Los Angeles Police Dept'),
    'NYPD': ('Police Aviation', 'New York Police Dept'),
    'CHI': ('Police Aviation', 'Chicago Police Dept'),
}

# Surveillance aircraft types
SURVEILLANCE_AIRCRAFT_TYPES: Dict[str, Dict[str, str]] = {
    # Fixed-wing surveillance
    'C208': {'name': 'Cessna 208 Caravan', 'role': 'Surveillance Platform'},
    'C206': {'name': 'Cessna 206', 'role': 'Light Surveillance'},
    'C182': {'name': 'Cessna 182', 'role': 'Light Surveillance'},
    'C172': {'name': 'Cessna 172', 'role': 'Light Surveillance'},
    'PA31': {'name': 'Piper PA-31 Navajo', 'role': 'Surveillance Platform'},
    'PC12': {'name': 'Pilatus PC-12', 'role': 'Surveillance Platform'},
    'BE20': {'name': 'Beechcraft King Air 200', 'role': 'Surveillance Platform'},
    'BE30': {'name': 'Beechcraft King Air 300', 'role': 'Surveillance Platform'},
    'BE35': {'name': 'Beechcraft King Air 350', 'role': 'Surveillance Platform'},

    # Helicopters commonly used by law enforcement
    'EC35': {'name': 'Eurocopter EC135', 'role': 'Police Helicopter'},
    'EC45': {'name': 'Eurocopter EC145', 'role': 'Police Helicopter'},
    'EC30': {'name': 'Eurocopter EC130', 'role': 'Police Helicopter'},
    'AS50': {'name': 'Airbus AS350', 'role': 'Police Helicopter'},
    'A119': {'name': 'AgustaWestland AW119', 'role': 'Police Helicopter'},
    'A139': {'name': 'AgustaWestland AW139', 'role': 'Police/Medical Helicopter'},
    'H125': {'name': 'Airbus H125', 'role': 'Police Helicopter'},
    'H130': {'name': 'Airbus H130', 'role': 'Police Helicopter'},
    'H135': {'name': 'Airbus H135', 'role': 'Police Helicopter'},
    'H145': {'name': 'Airbus H145', 'role': 'Police Helicopter'},
    'B06': {'name': 'Bell 206', 'role': 'Police Helicopter'},
    'B407': {'name': 'Bell 407', 'role': 'Police Helicopter'},
    'B429': {'name': 'Bell 429', 'role': 'Police Helicopter'},
    'S76': {'name': 'Sikorsky S-76', 'role': 'Police Helicopter'},
    'R44': {'name': 'Robinson R44', 'role': 'Light Helicopter'},
    'R66': {'name': 'Robinson R66', 'role': 'Light Helicopter'},

    # CBP specific
    'DHC6': {'name': 'DHC-6 Twin Otter', 'role': 'CBP Patrol'},
    'ULAC': {'name': 'UH-60 Black Hawk', 'role': 'CBP Air Interdiction'},
    'P3': {'name': 'P-3 Orion', 'role': 'CBP Long Range Tracker'},
}

# Helicopter category code
HELICOPTER_CATEGORIES = ['A7']


def identify_by_callsign(callsign: str) -> Optional[Dict[str, Any]]:
    """
    Identify law enforcement aircraft by callsign pattern.

    Args:
        callsign: Aircraft callsign (e.g., 'CHP123')

    Returns:
        Identification dictionary or None if not matched
    """
    if not callsign:
        return None

    callsign_upper = callsign.upper().strip()

    for pattern, category, description in LAW_ENFORCEMENT_CALLSIGN_PATTERNS:
        if re.match(pattern, callsign_upper, re.IGNORECASE):
            return {
                'is_law_enforcement': category not in ['News Media', 'Medical'],
                'is_interest': True,
                'category': category,
                'description': description,
                'source': 'callsign_pattern',
                'confidence': 'high',
            }

    return None


def identify_by_operator(operator_icao: str) -> Optional[Dict[str, Any]]:
    """
    Identify law enforcement aircraft by operator ICAO code.

    Args:
        operator_icao: Operator ICAO code (e.g., 'CBP')

    Returns:
        Identification dictionary or None if not found
    """
    if not operator_icao:
        return None

    operator_upper = operator_icao.upper().strip()

    if operator_upper in LAW_ENFORCEMENT_OPERATORS:
        category, description = LAW_ENFORCEMENT_OPERATORS[operator_upper]
        return {
            'is_law_enforcement': True,
            'is_interest': True,
            'category': category,
            'description': description,
            'source': 'operator_icao',
            'confidence': 'very_high',
        }

    return None


def is_surveillance_type(type_code: str) -> bool:
    """
    Check if aircraft type is commonly used for surveillance.

    Args:
        type_code: Aircraft type ICAO code

    Returns:
        True if type is commonly used for surveillance
    """
    if not type_code:
        return False
    return type_code.upper().strip() in SURVEILLANCE_AIRCRAFT_TYPES


def is_helicopter(category: str = None, type_code: str = None) -> bool:
    """
    Check if aircraft is a helicopter.

    Args:
        category: Aircraft category code (e.g., 'A7')
        type_code: Aircraft type code

    Returns:
        True if aircraft is a helicopter
    """
    if category and category.upper() in HELICOPTER_CATEGORIES:
        return True

    if type_code:
        type_upper = type_code.upper().strip()
        # Check if type is in surveillance types and marked as helicopter
        if type_upper in SURVEILLANCE_AIRCRAFT_TYPES:
            role = SURVEILLANCE_AIRCRAFT_TYPES[type_upper].get('role', '')
            return 'Helicopter' in role

    return False


def identify_law_enforcement(
    hex_code: Optional[str] = None,
    callsign: Optional[str] = None,
    operator: Optional[str] = None,
    registration: Optional[str] = None,
    category: Optional[str] = None,
    type_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Comprehensive law enforcement aircraft identification.

    Checks all available identifiers to determine if aircraft is law enforcement
    and provide additional information.

    Args:
        hex_code: Aircraft ICAO hex code
        callsign: Aircraft callsign
        operator: Operator ICAO code
        registration: Aircraft registration
        category: Aircraft category code
        type_code: Aircraft type code

    Returns:
        Identification result dictionary
    """
    result = {
        'is_law_enforcement': False,
        'is_helicopter': False,
        'is_surveillance_type': False,
        'is_interest': False,
        'confidence': 'none',
        'identifiers': [],
        'category': None,
        'description': None,
    }

    # Check operator (highest confidence)
    op_result = identify_by_operator(operator)
    if op_result:
        result.update({
            'is_law_enforcement': op_result['is_law_enforcement'],
            'is_interest': op_result['is_interest'],
            'confidence': 'very_high',
            'category': op_result['category'],
            'description': op_result['description'],
        })
        result['identifiers'].append('operator')

    # Check callsign pattern
    cs_result = identify_by_callsign(callsign)
    if cs_result:
        if not result['is_law_enforcement']:
            result['is_law_enforcement'] = cs_result['is_law_enforcement']
        result['is_interest'] = True
        if result['confidence'] == 'none':
            result['confidence'] = 'high'
        elif result['confidence'] == 'very_high':
            result['confidence'] = 'very_high'
        if not result['category']:
            result['category'] = cs_result['category']
            result['description'] = cs_result['description']
        result['identifiers'].append('callsign')

    # Check if helicopter
    result['is_helicopter'] = is_helicopter(category, type_code)
    if result['is_helicopter']:
        result['identifiers'].append('helicopter')

    # Check if surveillance type aircraft
    result['is_surveillance_type'] = is_surveillance_type(type_code)
    if result['is_surveillance_type']:
        result['identifiers'].append('surveillance_type')
        if result['confidence'] == 'none':
            result['confidence'] = 'low'

    # Set is_interest if any indicator is present
    if result['is_helicopter'] or result['is_surveillance_type'] or result['is_law_enforcement']:
        result['is_interest'] = True

    return result


def get_threat_level(
    aircraft_data: Dict[str, Any],
    distance_nm: float,
    le_info: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Calculate threat level based on aircraft type and distance.

    Args:
        aircraft_data: Aircraft data dictionary
        distance_nm: Distance in nautical miles
        le_info: Optional pre-computed law enforcement info

    Returns:
        Threat level: 'critical', 'warning', or 'info'
    """
    if le_info is None:
        le_info = identify_law_enforcement(
            hex_code=aircraft_data.get('hex'),
            callsign=aircraft_data.get('flight') or aircraft_data.get('callsign'),
            operator=aircraft_data.get('ownOp') or aircraft_data.get('operator'),
            category=aircraft_data.get('category'),
            type_code=aircraft_data.get('t') or aircraft_data.get('type'),
        )

    # Confirmed law enforcement
    if le_info['is_law_enforcement']:
        if distance_nm < 2:
            return 'critical'
        elif distance_nm < 5:
            return 'warning'
        else:
            return 'info'

    # Helicopter (possible LE)
    if le_info['is_helicopter']:
        if distance_nm < 3:
            return 'warning'
        else:
            return 'info'

    # Surveillance type aircraft
    if le_info['is_surveillance_type']:
        if distance_nm < 5:
            return 'warning'
        else:
            return 'info'

    return 'info'


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate bearing from point 1 to point 2.

    Args:
        lat1, lon1: Origin point coordinates
        lat2, lon2: Destination point coordinates

    Returns:
        Bearing in degrees (0-360)
    """
    import math

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)

    x = math.sin(dlon) * math.cos(lat2_rad)
    y = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(dlon)

    bearing = math.atan2(x, y)
    bearing = math.degrees(bearing)
    bearing = (bearing + 360) % 360

    return bearing


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two points using Haversine formula.

    Args:
        lat1, lon1: Point 1 coordinates
        lat2, lon2: Point 2 coordinates

    Returns:
        Distance in nautical miles
    """
    import math

    R = 3440.065  # Earth's radius in nautical miles

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def get_direction_name(bearing: float) -> str:
    """
    Convert bearing to compass direction name.

    Args:
        bearing: Bearing in degrees (0-360)

    Returns:
        Direction name (e.g., 'N', 'NE', 'E', etc.)
    """
    directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    index = round(bearing / 22.5) % 16
    return directions[index]


def get_trend(
    current_distance: float,
    previous_distance: Optional[float],
) -> str:
    """
    Determine if aircraft is approaching or departing.

    Args:
        current_distance: Current distance in nm
        previous_distance: Previous distance in nm (if available)

    Returns:
        'approaching', 'departing', or 'holding'
    """
    if previous_distance is None:
        return 'unknown'

    diff = current_distance - previous_distance
    if diff < -0.1:  # Getting closer by more than 0.1nm
        return 'approaching'
    elif diff > 0.1:  # Getting farther by more than 0.1nm
        return 'departing'
    else:
        return 'holding'


def get_all_patterns() -> Dict[str, Any]:
    """
    Get all configured law enforcement identification patterns.

    Returns:
        Dictionary with all patterns for reference
    """
    return {
        'callsign_patterns': [
            {
                'pattern': pattern,
                'category': category,
                'description': description,
            }
            for pattern, category, description in LAW_ENFORCEMENT_CALLSIGN_PATTERNS
        ],
        'operators': {
            code: {'category': cat, 'description': desc}
            for code, (cat, desc) in LAW_ENFORCEMENT_OPERATORS.items()
        },
        'surveillance_types': SURVEILLANCE_AIRCRAFT_TYPES,
        'helicopter_categories': HELICOPTER_CATEGORIES,
    }
