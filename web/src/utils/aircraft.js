// ============================================================================
// Aircraft Helper Functions
// ============================================================================

import { COUNTRY_RANGES, CATEGORY_NAMES } from './constants';

// US N-number conversion (ICAO range: A00001 - AFFFFF)
export const icaoToNNumber = (hex) => {
  const icao = parseInt(hex, 16);
  const base = 0xA00001;
  const end = 0xAFFFFF;
  
  if (icao < base || icao > end) return null;
  
  const offset = icao - base;
  
  if (offset < 0) return null;
  
  // Simplified decode - returns approximate N-number
  const n1 = Math.floor(offset / 101711);
  const rem1 = offset % 101711;
  const n2 = Math.floor(rem1 / 10111);
  
  if (n1 > 9) return `N${n1}${n2}...`;
  
  let result = 'N' + (n1 + 1);
  if (n2 <= 9) {
    result += n2;
  }
  
  return result.length >= 2 ? result : null;
};

// Get country from ICAO hex
export const getCountryFromIcao = (hex) => {
  const icao = parseInt(hex, 16);
  
  for (const range of COUNTRY_RANGES) {
    if (icao >= range.start && icao <= range.end) {
      return range;
    }
  }
  return { country: '??', flag: '🏳️' };
};

// Get registration/tail number from ICAO
export const getTailNumber = (hex, flight) => {
  if (!hex) return null;
  
  const country = getCountryFromIcao(hex);
  
  // For US aircraft, try to decode N-number
  if (country.country === 'US') {
    const nNumber = icaoToNNumber(hex);
    if (nNumber) return nNumber;
  }
  
  // For other countries, if flight looks like a registration, use it
  if (flight && flight.trim()) {
    const f = flight.trim();
    if (/^[A-Z]-[A-Z]{3,4}$/.test(f) || 
        /^[A-Z]{2}-[A-Z]{3}$/.test(f) || 
        /^N\d+[A-Z]*$/.test(f)) {
      return f;
    }
  }
  
  return null;
};

// Combined tail info for popup display
// Can accept either (hex, flight) or (aircraft) object
export const getTailInfo = (hexOrAircraft, flight) => {
  let hex, flightId;
  
  if (typeof hexOrAircraft === 'object' && hexOrAircraft !== null) {
    // Aircraft object passed
    hex = hexOrAircraft.hex;
    flightId = hexOrAircraft.flight;
  } else {
    // Individual params passed
    hex = hexOrAircraft;
    flightId = flight;
  }
  
  const country = getCountryFromIcao(hex);
  const tailNumber = getTailNumber(hex, flightId);
  const callsign = flightId?.trim() || hex?.toUpperCase() || '--';
  
  return {
    tailNumber,
    callsign,
    country: `${country.flag} ${country.country}`,
    countryCode: country.country,
    flag: country.flag
  };
};

// Translate ADS-B category codes to human readable
export const getCategoryName = (category) => {
  return CATEGORY_NAMES[category] || category || 'Unknown';
};

// Wind direction to cardinal
export const windDirToCardinal = (deg) => {
  if (deg === null || deg === undefined || isNaN(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return dirs[index];
};

// Common IATA to ICAO airline code mapping for ACARS matching
// ACARS typically uses IATA codes (2-letter), ADS-B uses ICAO codes (3-letter)
const IATA_TO_ICAO = {
  'AA': 'AAL', // American Airlines
  'AS': 'ASA', // Alaska Airlines
  'B6': 'JBU', // JetBlue
  'DL': 'DAL', // Delta
  'F9': 'FFT', // Frontier
  'G4': 'AAY', // Allegiant
  'HA': 'HAL', // Hawaiian
  'NK': 'NKS', // Spirit
  'UA': 'UAL', // United
  'WN': 'SWA', // Southwest
  'AC': 'ACA', // Air Canada
  'AM': 'AMX', // AeroMexico
  'BA': 'BAW', // British Airways
  'AF': 'AFR', // Air France
  'LH': 'DLH', // Lufthansa
  'QF': 'QFA', // Qantas
  'EK': 'UAE', // Emirates
  'SQ': 'SIA', // Singapore Airlines
  'CX': 'CPA', // Cathay Pacific
  'JL': 'JAL', // Japan Airlines
  'NH': 'ANA', // All Nippon Airways
  'KE': 'KAL', // Korean Air
  'OZ': 'AAR', // Asiana
  'CA': 'CCA', // Air China
  'MU': 'CES', // China Eastern
  'CZ': 'CSN', // China Southern
  'TK': 'THY', // Turkish Airlines
  'QR': 'QTR', // Qatar Airways
  'EY': 'ETD', // Etihad
  'VS': 'VIR', // Virgin Atlantic
  'AZ': 'ITY', // ITA Airways (formerly Alitalia)
  'IB': 'IBE', // Iberia
  'KL': 'KLM', // KLM
  'SK': 'SAS', // SAS
  'AY': 'FIN', // Finnair
  'OS': 'AUA', // Austrian
  'LX': 'SWR', // Swiss
  'TP': 'TAP', // TAP Portugal
  'WS': 'WJA', // WestJet
  'FI': 'ICE', // Icelandair
  'EI': 'EIN', // Aer Lingus
  'SU': 'AFL', // Aeroflot
  'VY': 'VLG', // Vueling
  'FR': 'RYR', // Ryanair
  'U2': 'EZY', // easyJet
  'W6': 'WZZ', // Wizz Air
  'MX': 'MXA', // Mexicana (some legacy)
  'Y4': 'VOI', // Volaris
  '5D': 'SLI', // Aerolitoral
  'VX': 'VRD', // Virgin America (merged into AS)
  'QX': 'QXE', // Horizon Air
  'OH': 'COM', // Comair
  'OO': 'SKW', // SkyWest
  'YX': 'RPA', // Republic Airways
  'YV': 'ASQ', // Mesa Airlines
  'MQ': 'EGF', // Envoy Air
  '9E': 'EDV', // Endeavor Air
  'PT': 'PDT', // Piedmont Airlines
  'ZW': 'AWI', // Air Wisconsin
  'G7': 'GJS', // GoJet
  'AX': 'AAX', // Trans States (now part of AAL)
  'CP': 'CDN', // Canadian Airlines (legacy)
  'NW': 'NWA', // Northwest (merged into DAL)
  'CO': 'COA', // Continental (merged into UAL)
  'US': 'USA', // US Airways (merged into AAL)
  'HP': 'AWE', // America West (merged)
};

// Build reverse mapping (ICAO to IATA)
const ICAO_TO_IATA = Object.fromEntries(
  Object.entries(IATA_TO_ICAO).map(([iata, icao]) => [icao, iata])
);

/**
 * Extract airline code and flight number from a callsign
 * @param {string} callsign - e.g., "UAL123" or "UA123" or "UAL1234"
 * @returns {{ airlineCode: string, flightNum: string } | null}
 */
const parseCallsign = (callsign) => {
  if (!callsign) return null;
  const cs = callsign.trim().toUpperCase();

  // Try 3-letter ICAO code first (e.g., "UAL123")
  const icaoMatch = cs.match(/^([A-Z]{3})(\d+[A-Z]?)$/);
  if (icaoMatch) {
    return { airlineCode: icaoMatch[1], flightNum: icaoMatch[2], isIcao: true };
  }

  // Try 2-letter IATA code (e.g., "UA123")
  const iataMatch = cs.match(/^([A-Z]{2})(\d+[A-Z]?)$/);
  if (iataMatch) {
    return { airlineCode: iataMatch[1], flightNum: iataMatch[2], isIcao: false };
  }

  // Try alphanumeric codes like "G4123" (Allegiant), "B6123" (JetBlue), "F91234" (Frontier)
  const alphaNumMatch = cs.match(/^([A-Z]\d)(\d+[A-Z]?)$/);
  if (alphaNumMatch) {
    return { airlineCode: alphaNumMatch[1], flightNum: alphaNumMatch[2], isIcao: false };
  }

  return null;
};

/**
 * Check if two callsigns match, accounting for IATA/ICAO differences
 * @param {string} acarsCallsign - Callsign from ACARS message (often IATA format)
 * @param {string} adsbCallsign - Callsign from ADS-B data (often ICAO format)
 * @returns {boolean}
 */
export const callsignsMatch = (acarsCallsign, adsbCallsign) => {
  if (!acarsCallsign || !adsbCallsign) return false;

  const acars = acarsCallsign.trim().toUpperCase();
  const adsb = adsbCallsign.trim().toUpperCase();

  // Direct match
  if (acars === adsb) return true;

  // Parse both callsigns
  const acarsParsed = parseCallsign(acars);
  const adsbParsed = parseCallsign(adsb);

  if (!acarsParsed || !adsbParsed) return false;

  // Flight numbers must match
  if (acarsParsed.flightNum !== adsbParsed.flightNum) return false;

  // Check if airline codes match after conversion
  const acarsCode = acarsParsed.airlineCode;
  const adsbCode = adsbParsed.airlineCode;

  // Direct airline code match
  if (acarsCode === adsbCode) return true;

  // Convert ACARS IATA to ICAO and compare with ADS-B
  if (!acarsParsed.isIcao && IATA_TO_ICAO[acarsCode] === adsbCode) return true;

  // Convert ADS-B ICAO to IATA and compare with ACARS
  if (acarsParsed.isIcao && acarsCode === IATA_TO_ICAO[adsbCode]) return true;

  // Try reverse: ACARS is ICAO, ADS-B is IATA (less common but possible)
  if (acarsParsed.isIcao && ICAO_TO_IATA[acarsCode] === adsbCode) return true;
  if (!adsbParsed.isIcao && acarsCode === ICAO_TO_IATA[adsbCode]) return true;

  return false;
};

// PIREP type classification for coloring
export const getPirepType = (pirep) => {
  const rawText = pirep.raw_text || pirep.rawOb || '';
  const hasTurb = !!(pirep.turbulence_type || pirep.turbulence || rawText.includes('/TB'));
  const hasIce = !!(pirep.icing_type || pirep.icing || rawText.includes('/IC'));
  const hasWS = !!(rawText.includes('/WS') || rawText.includes('LLWS'));
  const isUrgent = pirep.report_type === 'UUA' || pirep.pirepType === 'UUA' || rawText.includes(' UUA ');

  if (isUrgent) return 'urgent';
  if (hasWS) return 'windshear';
  if (hasTurb && hasIce) return 'both';
  if (hasTurb) return 'turbulence';
  if (hasIce) return 'icing';
  return 'routine';
};
