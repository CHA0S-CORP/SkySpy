// ============================================================================
// METAR Utility Functions for Flight Category Determination
// Phase 10.3: METAR/TAF Airport Weather Indicators
// ============================================================================

/**
 * Flight category thresholds per FAA regulations:
 * - VFR: Ceiling > 3000ft AND visibility > 5sm
 * - MVFR: Ceiling 1000-3000ft OR visibility 3-5sm
 * - IFR: Ceiling 500-1000ft OR visibility 1-3sm
 * - LIFR: Ceiling < 500ft OR visibility < 1sm
 */

export const FLIGHT_CATEGORIES = {
  VFR: {
    code: 'VFR',
    name: 'Visual Flight Rules',
    description: 'Ceiling > 3000ft AND visibility > 5sm',
    color: 'rgba(0, 255, 0, 0.8)', // Green
    mapColor: 'rgba(0, 200, 0, 0.7)',
    cssClass: 'vfr',
  },
  MVFR: {
    code: 'MVFR',
    name: 'Marginal VFR',
    description: 'Ceiling 1000-3000ft OR visibility 3-5sm',
    color: 'rgba(100, 150, 255, 0.8)', // Blue
    mapColor: 'rgba(80, 140, 255, 0.7)',
    cssClass: 'mvfr',
  },
  IFR: {
    code: 'IFR',
    name: 'Instrument Flight Rules',
    description: 'Ceiling 500-1000ft OR visibility 1-3sm',
    color: 'rgba(255, 100, 100, 0.8)', // Red
    mapColor: 'rgba(255, 80, 80, 0.7)',
    cssClass: 'ifr',
  },
  LIFR: {
    code: 'LIFR',
    name: 'Low IFR',
    description: 'Ceiling < 500ft OR visibility < 1sm',
    color: 'rgba(255, 50, 200, 0.8)', // Magenta
    mapColor: 'rgba(255, 40, 180, 0.7)',
    cssClass: 'lifr',
  },
};

/**
 * Get the lowest cloud layer that qualifies as a ceiling (BKN/OVC/VV)
 * @param {Array} clouds - Array of cloud layer objects with {cover, base}
 * @returns {number|null} - Ceiling height in feet AGL, or null if none
 */
export const getCeiling = (clouds) => {
  if (!clouds || !Array.isArray(clouds) || clouds.length === 0) {
    return null;
  }

  // Ceiling is the lowest layer that is BKN, OVC, or VV (vertical visibility)
  const ceilingLayers = clouds.filter(
    (c) => c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV'
  );

  if (ceilingLayers.length === 0) {
    return null; // No ceiling - clear or few/scattered only
  }

  // Return the lowest ceiling
  const bases = ceilingLayers.map((c) => c.base).filter((b) => b != null && !isNaN(b));
  return bases.length > 0 ? Math.min(...bases) : null;
};

/**
 * Calculate flight category from METAR data
 * @param {Object} metar - METAR object with visibility and clouds
 * @returns {string} - Flight category code: 'VFR', 'MVFR', 'IFR', or 'LIFR'
 */
export const getFlightCategory = (metar) => {
  if (!metar) return 'VFR';

  // If METAR already has flight category from backend, use it
  if (metar.fltCat) {
    return metar.fltCat;
  }

  // Extract visibility (in statute miles)
  const visibility = metar.visib ?? metar.visibility ?? null;

  // Get ceiling from cloud layers
  const ceiling = getCeiling(metar.clouds);

  // Apply FAA flight category rules
  // Note: More restrictive condition wins (e.g., if visibility is VFR but ceiling is IFR, result is IFR)

  // Check for LIFR first (most restrictive)
  if ((visibility !== null && visibility < 1) || (ceiling !== null && ceiling < 500)) {
    return 'LIFR';
  }

  // Check for IFR
  if (
    (visibility !== null && visibility >= 1 && visibility < 3) ||
    (ceiling !== null && ceiling >= 500 && ceiling < 1000)
  ) {
    return 'IFR';
  }

  // Check for MVFR
  if (
    (visibility !== null && visibility >= 3 && visibility <= 5) ||
    (ceiling !== null && ceiling >= 1000 && ceiling <= 3000)
  ) {
    return 'MVFR';
  }

  // Default to VFR
  return 'VFR';
};

/**
 * Get flight category info object with color and description
 * @param {Object|string} metarOrCategory - METAR object or category code string
 * @returns {Object} - Flight category info object
 */
export const getFlightCategoryInfo = (metarOrCategory) => {
  let category;
  if (typeof metarOrCategory === 'string') {
    category = metarOrCategory;
  } else {
    category = getFlightCategory(metarOrCategory);
  }
  return FLIGHT_CATEGORIES[category] || FLIGHT_CATEGORIES.VFR;
};

/**
 * Get color for flight category (for canvas/map rendering)
 * @param {Object|string} metarOrCategory - METAR object or category code string
 * @param {boolean} forMap - If true, return map-optimized color; otherwise return UI color
 * @returns {string} - RGBA color string
 */
export const getFlightCategoryColor = (metarOrCategory, forMap = false) => {
  const info = getFlightCategoryInfo(metarOrCategory);
  return forMap ? info.mapColor : info.color;
};

/**
 * Format wind information from METAR
 * @param {Object} metar - METAR object
 * @returns {string|null} - Formatted wind string or null
 */
export const formatMetarWind = (metar) => {
  if (!metar) return null;

  const dir = metar.wdir;
  const speed = metar.wspd;
  const gust = metar.wgst;

  if (speed === undefined || speed === null) return null;

  let dirStr = 'VRB';
  if (dir !== undefined && dir !== null && dir !== 0) {
    dirStr = `${String(dir).padStart(3, '0')}°`;
  } else if (dir === 0 && speed === 0) {
    return 'Calm';
  }

  let result = `${dirStr} @ ${speed}kt`;
  if (gust && gust > speed) {
    result += ` G${gust}kt`;
  }

  return result;
};

/**
 * Format visibility from METAR
 * @param {Object} metar - METAR object
 * @returns {string|null} - Formatted visibility string or null
 */
export const formatMetarVisibility = (metar) => {
  if (!metar || metar.visib === undefined || metar.visib === null) return null;

  const vis = metar.visib;
  if (vis >= 10) {
    return '10+ SM';
  }
  if (vis >= 1) {
    return `${vis} SM`;
  }
  // Less than 1 mile - show as fraction
  if (vis >= 0.5) {
    return '1/2 SM';
  }
  if (vis >= 0.25) {
    return '1/4 SM';
  }
  return `${vis} SM`;
};

/**
 * Format ceiling/clouds from METAR
 * @param {Object} metar - METAR object
 * @returns {string|null} - Formatted ceiling string or null
 */
export const formatMetarCeiling = (metar) => {
  if (!metar || !metar.clouds || metar.clouds.length === 0) {
    return 'Clear';
  }

  const ceiling = getCeiling(metar.clouds);
  if (ceiling === null) {
    // No ceiling - show lowest cloud layer
    const lowestCloud = metar.clouds.reduce((lowest, c) => {
      if (c.base != null && (lowest === null || c.base < lowest.base)) {
        return c;
      }
      return lowest;
    }, null);

    if (lowestCloud) {
      return `${lowestCloud.cover} ${lowestCloud.base?.toLocaleString() || '???'} ft`;
    }
    return 'Clear';
  }

  // Find the ceiling layer
  const ceilingLayer = metar.clouds.find(
    (c) => (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV') && c.base === ceiling
  );

  const cover = ceilingLayer?.cover || 'CLG';
  return `${cover} ${ceiling.toLocaleString()} ft`;
};

/**
 * Format temperature and dewpoint from METAR
 * @param {Object} metar - METAR object
 * @returns {string|null} - Formatted temp/dewpoint string or null
 */
export const formatMetarTempDew = (metar) => {
  if (!metar) return null;

  const temp = metar.temp;
  const dewp = metar.dewp;

  if (temp === undefined || temp === null) return null;

  let result = `${temp}°C`;
  if (dewp !== undefined && dewp !== null) {
    result += ` / ${dewp}°C`;
  }

  return result;
};

/**
 * Format a compact METAR summary for tooltips
 * @param {Object} metar - METAR object
 * @returns {Object} - Formatted METAR summary object
 */
export const formatMetar = (metar) => {
  if (!metar) return null;

  const category = getFlightCategory(metar);
  const categoryInfo = getFlightCategoryInfo(category);

  return {
    stationId: metar.stationId || metar.icaoId || 'UNKN',
    observationTime: metar.obsTime || metar.observation_time || null,
    flightCategory: category,
    flightCategoryInfo: categoryInfo,
    wind: formatMetarWind(metar),
    visibility: formatMetarVisibility(metar),
    ceiling: formatMetarCeiling(metar),
    tempDew: formatMetarTempDew(metar),
    rawOb: metar.rawOb || metar.raw_text || null,
    // Numeric values for further processing
    raw: {
      visibility: metar.visib,
      ceiling: getCeiling(metar.clouds),
      temperature: metar.temp,
      dewpoint: metar.dewp,
      windSpeed: metar.wspd,
      windDirection: metar.wdir,
      windGust: metar.wgst,
    },
  };
};

/**
 * Find METAR data for an airport by matching station ID
 * @param {Object} airport - Airport object with icao, icaoId, faaId, or id
 * @param {Array} metars - Array of METAR objects
 * @returns {Object|null} - Matching METAR or null
 */
export const findMetarForAirport = (airport, metars) => {
  if (!airport || !metars || !Array.isArray(metars) || metars.length === 0) {
    return null;
  }

  // Get all possible identifiers for the airport
  const airportIds = [airport.icao, airport.icaoId, airport.faaId, airport.id]
    .filter(Boolean)
    .map((id) => id.toUpperCase());

  if (airportIds.length === 0) return null;

  // Find matching METAR
  const metar = metars.find((m) => {
    const metarId = (m.stationId || m.icaoId || '').toUpperCase();
    return airportIds.includes(metarId);
  });

  return metar || null;
};

/**
 * Get airport color based on flight category from METAR data
 * Falls back to airspace class color if no METAR available
 * @param {Object} airport - Airport object
 * @param {Array} metars - Array of METAR objects
 * @param {boolean} useFlightCategory - Whether to use flight category colors
 * @returns {string} - RGBA color string
 */
export const getAirportColor = (airport, metars, useFlightCategory = true) => {
  if (useFlightCategory && metars && metars.length > 0) {
    const metar = findMetarForAirport(airport, metars);
    if (metar) {
      return getFlightCategoryColor(metar, true);
    }
  }

  // Fallback to airspace class-based coloring
  const aptClass = airport.class || 'E';
  switch (aptClass) {
    case 'B':
      return 'rgba(100, 150, 255, 0.7)';
    case 'C':
      return 'rgba(200, 100, 200, 0.7)';
    case 'D':
      return 'rgba(100, 200, 100, 0.7)';
    default:
      return 'rgba(180, 180, 180, 0.6)';
  }
};

/**
 * Check if METAR data is stale (older than threshold)
 * @param {Object} metar - METAR object
 * @param {number} maxAgeMinutes - Maximum age in minutes (default 90)
 * @returns {boolean} - True if METAR is stale
 */
export const isMetarStale = (metar, maxAgeMinutes = 90) => {
  if (!metar) return true;

  const obsTime = metar.obsTime || metar.observation_time;
  if (!obsTime) return true;

  try {
    const obsDate = new Date(obsTime);
    const now = new Date();
    const ageMinutes = (now - obsDate) / (1000 * 60);
    return ageMinutes > maxAgeMinutes;
  } catch {
    return true;
  }
};

/**
 * Get METAR age in minutes
 * @param {Object} metar - METAR object
 * @returns {number} - Age in minutes, or -1 if unable to determine
 */
export const getMetarAgeMinutes = (metar) => {
  if (!metar) return -1;

  const obsTime = metar.obsTime || metar.observation_time;
  if (!obsTime) return -1;

  try {
    const obsDate = new Date(obsTime);
    const now = new Date();
    return Math.floor((now - obsDate) / (1000 * 60));
  } catch {
    return -1;
  }
};
