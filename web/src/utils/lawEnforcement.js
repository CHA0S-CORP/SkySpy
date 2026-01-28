/**
 * Law enforcement aircraft detection utilities
 *
 * Client-side patterns for identifying law enforcement,
 * federal, and surveillance aircraft.
 */

// Law enforcement callsign patterns (simplified for client-side)
const LAW_ENFORCEMENT_PATTERNS = [
  // Police helicopters - specific agencies
  { pattern: /^N?(PAS|POL)\d*/i, category: 'Police Aviation', description: 'Police Air Support' },
  { pattern: /^CHP\d*/i, category: 'Police Aviation', description: 'California Highway Patrol' },
  { pattern: /^LAPD\d*/i, category: 'Police Aviation', description: 'Los Angeles Police Dept' },
  { pattern: /^NYPD\d*/i, category: 'Police Aviation', description: 'New York Police Dept' },
  { pattern: /^SFPD\d*/i, category: 'Police Aviation', description: 'San Francisco Police Dept' },
  { pattern: /^CPD\d*/i, category: 'Police Aviation', description: 'Chicago Police Dept' },
  { pattern: /^HPD\d*/i, category: 'Police Aviation', description: 'Houston Police Dept' },
  { pattern: /^MPD\d*/i, category: 'Police Aviation', description: 'Metropolitan Police Dept' },

  // Generic police patterns
  { pattern: /^POLICE\d*/i, category: 'Police Aviation', description: 'Police' },
  { pattern: /^COPTER\d*/i, category: 'Police Aviation', description: 'Police Helicopter' },
  { pattern: /^SHERIFF\d*/i, category: 'Police Aviation', description: 'Sheriff' },
  { pattern: /^ASO\d*/i, category: 'Police Aviation', description: 'Air Support Operations' },

  // Sheriff offices
  { pattern: /^[A-Z]CSO\d*/i, category: 'Police Aviation', description: 'County Sheriff Office' },

  // Federal agencies
  { pattern: /^CBP\d*/i, category: 'Federal Law Enforcement', description: 'Customs & Border Protection' },
  { pattern: /^OMAHA\d*/i, category: 'Federal Law Enforcement', description: 'CBP Air & Marine' },
  { pattern: /^BORDER\d*/i, category: 'Federal Law Enforcement', description: 'Border Patrol' },
  { pattern: /^USMS\d*/i, category: 'Federal Law Enforcement', description: 'US Marshals Service' },
  { pattern: /^JPATS\d*/i, category: 'Federal Law Enforcement', description: 'Justice Prisoner Transport' },
  { pattern: /^ICE\d*/i, category: 'Federal Law Enforcement', description: 'Immigration & Customs Enforcement' },
  { pattern: /^DEA\d*/i, category: 'Federal Law Enforcement', description: 'Drug Enforcement Admin' },
  { pattern: /^ATF\d*/i, category: 'Federal Law Enforcement', description: 'ATF' },
  { pattern: /^FBI\d*/i, category: 'Federal Law Enforcement', description: 'FBI' },
  { pattern: /^DHS\d*/i, category: 'Federal Law Enforcement', description: 'Dept of Homeland Security' },

  // State patrol patterns
  { pattern: /^TROOPER\d*/i, category: 'State Police', description: 'State Trooper' },
  { pattern: /^PATROL\d*/i, category: 'State Police', description: 'State Patrol' },
  { pattern: /^STATE\d*/i, category: 'State Police', description: 'State Police' },
  { pattern: /^[A-Z]HP\d*/i, category: 'State Police', description: 'Highway Patrol' },
  { pattern: /^[A-Z]SP\d*/i, category: 'State Police', description: 'State Police' },

  // News helicopters (often follow enforcement)
  { pattern: /^NEWS\d+/i, category: 'News Media', description: 'News Helicopter', isNews: true },
  { pattern: /^CHOPPER\d+/i, category: 'News Media', description: 'News Helicopter', isNews: true },
  { pattern: /^SKY\d+/i, category: 'News Media', description: 'Sky News', isNews: true },
  { pattern: /^K[A-Z]{3}\d*/i, category: 'News Media', description: 'TV Station Helicopter', isNews: true },
  { pattern: /^W[A-Z]{3}\d*/i, category: 'News Media', description: 'TV Station Helicopter', isNews: true },
];

// Helicopter category codes
const HELICOPTER_CATEGORIES = ['A7'];

// Surveillance-capable aircraft types
const SURVEILLANCE_TYPES = [
  'C208', 'C206', 'C182', 'C172', // Cessna surveillance platforms
  'PC12', 'BE20', 'BE30', 'BE35', // King Air variants
  'PA31', // Piper Navajo
  'EC35', 'EC45', 'EC30', 'AS50', // Eurocopter
  'H125', 'H130', 'H135', 'H145', // Airbus Helicopters
  'A119', 'A139', // AgustaWestland
  'B06', 'B407', 'B429', // Bell helicopters
  'S76', 'R44', 'R66', // Other helicopters
];

/**
 * Identify law enforcement aircraft by callsign
 * @param {string} callsign - Aircraft callsign
 * @returns {Object|null} Match info or null
 */
export function identifyByCallsign(callsign) {
  if (!callsign) return null;

  const cs = callsign.trim().toUpperCase();

  for (const entry of LAW_ENFORCEMENT_PATTERNS) {
    if (entry.pattern.test(cs)) {
      return {
        isLawEnforcement: !entry.isNews,
        isInterest: true,
        category: entry.category,
        description: entry.description,
        source: 'callsign',
        confidence: 'high',
      };
    }
  }

  return null;
}

/**
 * Check if aircraft is a helicopter
 * @param {string} category - Aircraft category code
 * @param {string} typeCode - Aircraft type code
 * @returns {boolean}
 */
export function isHelicopter(category, typeCode) {
  if (category && HELICOPTER_CATEGORIES.includes(category.toUpperCase())) {
    return true;
  }

  if (typeCode) {
    const type = typeCode.toUpperCase();
    // Common helicopter type patterns
    if (type.match(/^(EC|AS|H1|A1|B[0-9]|S[0-9]|R[0-9]|UH|AH|CH|BK)/)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if aircraft type is surveillance-capable
 * @param {string} typeCode - Aircraft type code
 * @returns {boolean}
 */
export function isSurveillanceType(typeCode) {
  if (!typeCode) return false;
  return SURVEILLANCE_TYPES.includes(typeCode.toUpperCase());
}

/**
 * Comprehensive law enforcement identification
 * @param {Object} aircraft - Aircraft data object
 * @returns {Object} Identification result
 */
export function identifyLawEnforcement(aircraft) {
  if (!aircraft) {
    return {
      isLawEnforcement: false,
      isHelicopter: false,
      isSurveillanceType: false,
      isInterest: false,
      category: null,
      description: null,
      confidence: 'none',
    };
  }

  const callsign = aircraft.flight || aircraft.callsign;
  const category = aircraft.category;
  const typeCode = aircraft.t || aircraft.type;

  // Check callsign pattern
  const callsignMatch = identifyByCallsign(callsign);

  // Check if helicopter
  const heli = isHelicopter(category, typeCode);

  // Check if surveillance type
  const survType = isSurveillanceType(typeCode);

  const result = {
    isLawEnforcement: callsignMatch?.isLawEnforcement || false,
    isHelicopter: heli,
    isSurveillanceType: survType,
    isInterest: callsignMatch?.isInterest || heli || survType,
    category: callsignMatch?.category || (heli ? 'Helicopter' : null),
    description: callsignMatch?.description || null,
    confidence: callsignMatch?.confidence || 'none',
  };

  return result;
}

/**
 * Calculate threat level based on aircraft info and distance
 * @param {Object} aircraft - Aircraft data
 * @param {number} distanceNm - Distance in nautical miles
 * @param {Object} leInfo - Optional pre-computed law enforcement info
 * @returns {string} 'critical', 'warning', or 'info'
 */
export function getThreatLevel(aircraft, distanceNm, leInfo = null) {
  if (!leInfo) {
    leInfo = identifyLawEnforcement(aircraft);
  }

  // Confirmed law enforcement
  if (leInfo.isLawEnforcement) {
    if (distanceNm < 2) return 'critical';
    if (distanceNm < 5) return 'warning';
    return 'info';
  }

  // Helicopter (possible LE)
  if (leInfo.isHelicopter) {
    if (distanceNm < 3) return 'warning';
    return 'info';
  }

  // Surveillance type
  if (leInfo.isSurveillanceType) {
    if (distanceNm < 5) return 'warning';
    return 'info';
  }

  return 'info';
}

/**
 * Calculate distance between two points (Haversine formula)
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distance in nautical miles
 */
export function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate bearing from point 1 to point 2
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Bearing in degrees (0-360)
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const x = Math.sin(dLon) * Math.cos(lat2Rad);
  const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let bearing = Math.atan2(x, y);
  bearing = toDeg(bearing);
  return (bearing + 360) % 360;
}

/**
 * Get compass direction name from bearing
 * @param {number} bearing - Bearing in degrees
 * @returns {string} Direction name (N, NE, E, etc.)
 */
export function getDirectionName(bearing) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

function toDeg(rad) {
  return rad * (180 / Math.PI);
}

export default {
  identifyByCallsign,
  identifyLawEnforcement,
  isHelicopter,
  isSurveillanceType,
  getThreatLevel,
  calculateDistanceNm,
  calculateBearing,
  getDirectionName,
};
