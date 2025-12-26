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

// PIREP type classification for coloring
export const getPirepType = (pirep) => {
  const hasTurb = !!(pirep.turbulence || (pirep.rawOb && pirep.rawOb.includes('/TB')));
  const hasIce = !!(pirep.icing || (pirep.rawOb && pirep.rawOb.includes('/IC')));
  const hasWS = !!(pirep.rawOb && (pirep.rawOb.includes('/WS') || pirep.rawOb.includes('LLWS')));
  const isUrgent = pirep.pirepType === 'UUA' || (pirep.rawOb && pirep.rawOb.includes(' UUA '));
  
  if (isUrgent) return 'urgent';
  if (hasWS) return 'windshear';
  if (hasTurb && hasIce) return 'both';
  if (hasTurb) return 'turbulence';
  if (hasIce) return 'icing';
  return 'routine';
};
