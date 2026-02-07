// ============================================================================
// TAF (Terminal Aerodrome Forecast) Utility Functions
// Phase 10.3: METAR/TAF Airport Weather Indicators
// ============================================================================

import { FLIGHT_CATEGORIES } from './metarUtils';

/**
 * TAF change group types
 */
export const TAF_CHANGE_TYPES = {
  FM: {
    code: 'FM',
    name: 'From',
    description: 'New prevailing conditions starting at specified time',
    priority: 1,
  },
  TEMPO: {
    code: 'TEMPO',
    name: 'Temporary',
    description: 'Temporary fluctuations lasting less than 1 hour each',
    priority: 2,
  },
  BECMG: {
    code: 'BECMG',
    name: 'Becoming',
    description: 'Gradual change expected during specified period',
    priority: 2,
  },
  PROB30: {
    code: 'PROB30',
    name: '30% Probability',
    description: '30% chance of conditions occurring',
    priority: 3,
  },
  PROB40: {
    code: 'PROB40',
    name: '40% Probability',
    description: '40% chance of conditions occurring',
    priority: 3,
  },
};

/**
 * Significant weather phenomena in TAFs
 */
export const SIGNIFICANT_WEATHER = {
  TS: { code: 'TS', name: 'Thunderstorm', severity: 'high', icon: 'zap' },
  FZRA: { code: 'FZRA', name: 'Freezing Rain', severity: 'high', icon: 'snowflake' },
  FZDZ: { code: 'FZDZ', name: 'Freezing Drizzle', severity: 'medium', icon: 'snowflake' },
  FZFG: { code: 'FZFG', name: 'Freezing Fog', severity: 'medium', icon: 'snowflake' },
  GR: { code: 'GR', name: 'Hail', severity: 'high', icon: 'cloud-hail' },
  FC: { code: 'FC', name: 'Funnel Cloud', severity: 'high', icon: 'tornado' },
  SQ: { code: 'SQ', name: 'Squall', severity: 'medium', icon: 'wind' },
  VA: { code: 'VA', name: 'Volcanic Ash', severity: 'high', icon: 'alert-triangle' },
  SN: { code: 'SN', name: 'Snow', severity: 'medium', icon: 'cloud-snow' },
  BLSN: { code: 'BLSN', name: 'Blowing Snow', severity: 'medium', icon: 'wind' },
  '+RA': { code: '+RA', name: 'Heavy Rain', severity: 'medium', icon: 'cloud-rain' },
};

/**
 * Format a TAF time for display
 * @param {string} isoTime - ISO 8601 timestamp
 * @param {boolean} includeDate - Whether to include date
 * @returns {string} Formatted time string
 */
export const formatTafTime = (isoTime, includeDate = false) => {
  if (!isoTime) return '--';

  try {
    const date = new Date(isoTime);
    if (isNaN(date.getTime())) return '--';

    if (includeDate) {
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      });
    }

    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '--';
  }
};

/**
 * Format TAF validity period for display
 * @param {string} validFrom - ISO timestamp
 * @param {string} validTo - ISO timestamp
 * @returns {string} Formatted validity period
 */
export const formatTafValidity = (validFrom, validTo) => {
  const from = formatTafTime(validFrom);
  const to = formatTafTime(validTo);

  if (from === '--' && to === '--') return 'Unknown validity';

  return `${from} - ${to}`;
};

/**
 * Format wind information from TAF data
 * @param {Object} wind - Wind object with direction, speed, gust
 * @returns {string} Formatted wind string
 */
export const formatTafWind = (wind) => {
  if (!wind) return null;

  const { direction, speed, gust } = wind;

  if (speed === 0) return 'Calm';

  let dirStr = 'VRB';
  if (direction !== 'VRB' && direction != null) {
    dirStr = `${String(direction).padStart(3, '0')}`;
  }

  let result = `${dirStr}@${speed}kt`;
  if (gust && gust > speed) {
    result += ` G${gust}`;
  }

  return result;
};

/**
 * Format visibility from TAF data
 * @param {Object} visibility - Visibility object
 * @returns {string} Formatted visibility string
 */
export const formatTafVisibility = (visibility) => {
  if (!visibility || visibility.value === undefined) return null;

  const { value, isGreaterThan } = visibility;

  if (isGreaterThan || value >= 6) {
    return 'P6SM';
  }

  if (value >= 1) {
    return `${value}SM`;
  }

  // Handle fractions
  if (value === 0.5) return '1/2SM';
  if (value === 0.25) return '1/4SM';
  if (value === 0.75) return '3/4SM';

  return `${value}SM`;
};

/**
 * Format ceiling from TAF data
 * @param {number} ceiling - Ceiling height in feet AGL
 * @returns {string} Formatted ceiling string
 */
export const formatTafCeiling = (ceiling) => {
  if (ceiling === null || ceiling === undefined) return 'Unlimited';

  return `${ceiling.toLocaleString()} ft AGL`;
};

/**
 * Format cloud layer for display
 * @param {Object} cloud - Cloud object with cover, base, type
 * @returns {string} Formatted cloud string
 */
export const formatCloudLayer = (cloud) => {
  if (!cloud) return '';

  const coverNames = {
    SKC: 'Clear',
    CLR: 'Clear',
    FEW: 'Few',
    SCT: 'Scattered',
    BKN: 'Broken',
    OVC: 'Overcast',
    VV: 'Vertical Vis',
  };

  const name = coverNames[cloud.cover] || cloud.cover;
  const base = cloud.base?.toLocaleString() || '???';
  const type = cloud.type ? ` ${cloud.type}` : '';

  return `${name} @ ${base}ft${type}`;
};

/**
 * Get the worst (most restrictive) flight category from a TAF
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {string} Worst flight category code
 */
export const getWorstForecastCategory = (decodedTaf) => {
  if (!decodedTaf) return 'VFR';

  const categoryOrder = ['VFR', 'MVFR', 'IFR', 'LIFR'];
  let worstIdx = 0;

  // Check base conditions
  const baseIdx = categoryOrder.indexOf(decodedTaf.currentCategory);
  if (baseIdx > worstIdx) worstIdx = baseIdx;

  // Check change groups
  if (decodedTaf.forecastCategories) {
    decodedTaf.forecastCategories.forEach((cat) => {
      const idx = categoryOrder.indexOf(cat);
      if (idx > worstIdx) worstIdx = idx;
    });
  }

  return categoryOrder[worstIdx];
};

/**
 * Check if TAF indicates improving conditions
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {boolean} True if conditions improve
 */
export const isTafImproving = (decodedTaf) => {
  if (!decodedTaf || !decodedTaf.changeGroups || decodedTaf.changeGroups.length === 0) {
    return false;
  }

  const categoryOrder = ['LIFR', 'IFR', 'MVFR', 'VFR'];
  const currentIdx = categoryOrder.indexOf(decodedTaf.currentCategory);

  // Find the last FM or BECMG group
  const lastPermanent = [...decodedTaf.changeGroups]
    .reverse()
    .find((g) => g.type === 'FM' || g.type === 'BECMG');

  if (lastPermanent && lastPermanent.flightCategory) {
    const finalIdx = categoryOrder.indexOf(lastPermanent.flightCategory);
    return finalIdx > currentIdx;
  }

  return false;
};

/**
 * Check if TAF indicates deteriorating conditions
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {boolean} True if conditions deteriorate
 */
export const isTafDeteriorating = (decodedTaf) => {
  if (!decodedTaf || !decodedTaf.changeGroups || decodedTaf.changeGroups.length === 0) {
    return false;
  }

  const categoryOrder = ['LIFR', 'IFR', 'MVFR', 'VFR'];
  const currentIdx = categoryOrder.indexOf(decodedTaf.currentCategory);

  // Check if any FM or BECMG shows worse conditions
  const hasDeterio = decodedTaf.changeGroups.some((g) => {
    if ((g.type === 'FM' || g.type === 'BECMG') && g.flightCategory) {
      return categoryOrder.indexOf(g.flightCategory) < currentIdx;
    }
    return false;
  });

  return hasDeterio;
};

/**
 * Get the next significant weather event from TAF
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {Object|null} Next significant weather event or null
 */
export const getNextSignificantWeather = (decodedTaf) => {
  if (!decodedTaf) return null;

  // Check base conditions first
  if (decodedTaf.baseConditions?.weather) {
    const significant = decodedTaf.baseConditions.weather.find((w) => w.isSignificant);
    if (significant) {
      return {
        ...significant,
        time: 'Current',
        type: 'BASE',
      };
    }
  }

  // Check change groups
  for (const group of decodedTaf.changeGroups || []) {
    if (group.weather) {
      const significant = group.weather.find((w) => w.isSignificant);
      if (significant) {
        return {
          ...significant,
          time: group.startTime,
          type: group.type,
          typeDesc: group.typeDesc,
        };
      }
    }
  }

  return null;
};

/**
 * Check if TAF data is stale
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {boolean} True if TAF is stale
 */
export const isTafStale = (decodedTaf) => {
  if (!decodedTaf) return true;

  // TAF is stale if it's expired
  if (decodedTaf.validTo) {
    const validTo = new Date(decodedTaf.validTo);
    if (validTo < new Date()) return true;
  }

  // TAF is stale if fetched more than 1 hour ago
  if (decodedTaf.fetchTime) {
    const age = Date.now() - decodedTaf.fetchTime;
    if (age > 3600000) return true; // 1 hour
  }

  return false;
};

/**
 * Get remaining TAF validity in hours
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {number} Hours remaining, or -1 if invalid
 */
export const getTafRemainingHours = (decodedTaf) => {
  if (!decodedTaf || !decodedTaf.validTo) return -1;

  try {
    const validTo = new Date(decodedTaf.validTo);
    const now = new Date();
    const diffMs = validTo - now;

    if (diffMs < 0) return 0;

    return Math.floor(diffMs / 3600000);
  } catch {
    return -1;
  }
};

/**
 * Generate a short summary of TAF conditions
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {string} Short summary text
 */
export const getTafSummary = (decodedTaf) => {
  if (!decodedTaf) return 'No TAF';

  const parts = [];

  // Current category
  parts.push(decodedTaf.currentCategory);

  // Trend
  if (isTafDeteriorating(decodedTaf)) {
    const worst = getWorstForecastCategory(decodedTaf);
    if (worst !== decodedTaf.currentCategory) {
      parts.push(`-> ${worst}`);
    }
  } else if (isTafImproving(decodedTaf)) {
    parts.push('Improving');
  }

  // Significant weather
  if (decodedTaf.hasSignificantWeather) {
    const wx = decodedTaf.significantWeather?.[0];
    if (wx) {
      parts.push(wx.code || wx.description);
    }
  }

  return parts.join(' ');
};

/**
 * Get flight category transition info for display
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {Object|null} Transition info or null
 */
export const getCategoryTransition = (decodedTaf) => {
  if (!decodedTaf) return null;

  const current = decodedTaf.currentCategory;
  const transitions = [];

  let lastCategory = current;
  for (const group of decodedTaf.changeGroups || []) {
    if (group.flightCategory && group.flightCategory !== lastCategory) {
      if (group.type === 'FM' || group.type === 'BECMG') {
        transitions.push({
          from: lastCategory,
          to: group.flightCategory,
          time: group.startTime,
          type: group.type,
          typeDesc: group.typeDesc,
        });
        lastCategory = group.flightCategory;
      } else if (group.type === 'TEMPO') {
        transitions.push({
          from: lastCategory,
          to: group.flightCategory,
          time: group.startTime,
          endTime: group.endTime,
          type: group.type,
          typeDesc: 'Temporary',
          isTemporary: true,
        });
      }
    }
  }

  if (transitions.length === 0) return null;

  return {
    current,
    transitions,
    worst: getWorstForecastCategory(decodedTaf),
  };
};

/**
 * Get color for TAF indicator based on forecast conditions
 * @param {Object} decodedTaf - Decoded TAF object
 * @returns {string} Color string
 */
export const getTafIndicatorColor = (decodedTaf) => {
  if (!decodedTaf) return 'rgba(128, 128, 128, 0.6)';

  // Base on worst forecast category
  const worst = getWorstForecastCategory(decodedTaf);
  const categoryInfo = FLIGHT_CATEGORIES[worst];

  return categoryInfo?.mapColor || 'rgba(128, 128, 128, 0.6)';
};

/**
 * Find TAF for an airport from a list of TAFs
 * @param {Object} airport - Airport object
 * @param {Array} tafs - Array of decoded TAF objects
 * @returns {Object|null} Matching TAF or null
 */
export const findTafForAirport = (airport, tafs) => {
  if (!airport || !tafs || !Array.isArray(tafs) || tafs.length === 0) {
    return null;
  }

  const airportIds = [airport.icao, airport.icaoId, airport.faaId, airport.id]
    .filter(Boolean)
    .map((id) => id.toUpperCase());

  if (airportIds.length === 0) return null;

  const taf = tafs.find((t) => {
    const tafId = (t.stationId || '').toUpperCase();
    return airportIds.includes(tafId);
  });

  return taf || null;
};
