/**
 * Separation Rules Utility
 * Phase 8.5 Implementation - Pro Radar Mode Separation Tools
 *
 * Provides functions for calculating required separation standards
 * and checking separation compliance between aircraft pairs.
 *
 * Separation Standards (FAA/ICAO):
 * - Lateral: 3nm within 40nm of radar, 5nm beyond
 * - Vertical: 1000ft below FL290, 2000ft at/above FL290 (RVSM)
 */

/**
 * Flight Level 290 threshold (29,000 feet) for RVSM vertical separation
 */
export const FL290_FEET = 29000;

/**
 * Terminal radar coverage distance (nm) for lateral separation reduction
 */
export const TERMINAL_RADAR_RANGE_NM = 40;

/**
 * Separation status codes
 */
export const SEPARATION_STATUS = {
  ADEQUATE: 'adequate',
  MARGINAL: 'marginal',
  VIOLATION: 'violation',
};

/**
 * Calculate the distance between two lat/lon coordinates in nautical miles
 *
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in nautical miles
 */
export function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  // Spherical approximation for short distances
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const avgLat = (lat1 + lat2) / 2;

  const nmY = dLat * 60; // 1 degree latitude = 60 nm
  const nmX = dLon * 60 * Math.cos((avgLat * Math.PI) / 180);

  return Math.sqrt(nmX * nmX + nmY * nmY);
}

/**
 * Calculate vertical separation between two aircraft in feet
 *
 * @param {number} alt1 - Altitude of first aircraft in feet
 * @param {number} alt2 - Altitude of second aircraft in feet
 * @returns {number} Vertical separation in feet (always positive)
 */
export function calculateVerticalSeparation(alt1, alt2) {
  if (alt1 == null || alt2 == null) return null;
  return Math.abs(alt1 - alt2);
}

/**
 * Get the required lateral separation based on distance from radar
 *
 * @param {number} distanceFromRadar - Distance from radar site in nm
 * @returns {{ required: number, type: string }} Required lateral separation and type
 */
export function getRequiredLateralSeparation(distanceFromRadar = 0) {
  if (distanceFromRadar <= TERMINAL_RADAR_RANGE_NM) {
    return {
      required: 3,
      type: 'terminal',
      description: 'Terminal (within 40nm)',
    };
  }
  return {
    required: 5,
    type: 'enroute',
    description: 'Enroute (beyond 40nm)',
  };
}

/**
 * Get the required vertical separation based on altitude (RVSM rules)
 *
 * @param {number} altitude1 - Altitude of first aircraft in feet
 * @param {number} altitude2 - Altitude of second aircraft in feet
 * @returns {{ required: number, type: string }} Required vertical separation and type
 */
export function getRequiredVerticalSeparation(altitude1, altitude2) {
  const maxAlt = Math.max(altitude1 || 0, altitude2 || 0);

  if (maxAlt >= FL290_FEET) {
    return {
      required: 2000,
      type: 'rvsm',
      description: 'RVSM (FL290+)',
    };
  }
  return {
    required: 1000,
    type: 'standard',
    description: 'Standard (below FL290)',
  };
}

/**
 * Get required separation between two aircraft
 *
 * @param {Object} aircraft1 - First aircraft { lat, lon, alt_baro or altitude }
 * @param {Object} aircraft2 - Second aircraft { lat, lon, alt_baro or altitude }
 * @param {number} distanceFromRadar - Optional distance from radar for lateral rules
 * @returns {Object} Required separation standards
 */
export function getRequiredSeparation(aircraft1, aircraft2, distanceFromRadar = 0) {
  const alt1 = aircraft1?.alt_baro ?? aircraft1?.altitude ?? null;
  const alt2 = aircraft2?.alt_baro ?? aircraft2?.altitude ?? null;

  return {
    lateral: getRequiredLateralSeparation(distanceFromRadar),
    vertical: getRequiredVerticalSeparation(alt1, alt2),
  };
}

/**
 * Calculate actual separation between two aircraft
 *
 * @param {Object} aircraft1 - First aircraft { lat, lon, alt_baro or altitude }
 * @param {Object} aircraft2 - Second aircraft { lat, lon, alt_baro or altitude }
 * @returns {Object} Actual separation values
 */
export function calculateSeparation(aircraft1, aircraft2) {
  if (!aircraft1 || !aircraft2) return null;

  const lat1 = aircraft1.lat;
  const lon1 = aircraft1.lon;
  const lat2 = aircraft2.lat;
  const lon2 = aircraft2.lon;

  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return null;
  }

  const alt1 = aircraft1.alt_baro ?? aircraft1.altitude ?? null;
  const alt2 = aircraft2.alt_baro ?? aircraft2.altitude ?? null;

  const lateralNm = calculateDistanceNm(lat1, lon1, lat2, lon2);
  const verticalFt = calculateVerticalSeparation(alt1, alt2);

  return {
    lateral: lateralNm,
    vertical: verticalFt,
    lateralFormatted: `${lateralNm.toFixed(1)} nm`,
    verticalFormatted: verticalFt != null ? `${verticalFt.toLocaleString()} ft` : 'N/A',
  };
}

/**
 * Determine separation status based on actual vs required separation
 * Returns status for both lateral and vertical separation
 *
 * @param {Object} actual - Actual separation { lateral, vertical }
 * @param {Object} required - Required separation { lateral: { required }, vertical: { required } }
 * @returns {Object} Status information
 */
export function getSeparationStatus(actual, required) {
  if (!actual || !required) return null;

  // Define marginal thresholds (percentage above minimum)
  const MARGINAL_THRESHOLD = 1.25; // 25% above minimum is marginal

  // Calculate lateral status
  let lateralStatus = SEPARATION_STATUS.ADEQUATE;
  if (actual.lateral < required.lateral.required) {
    lateralStatus = SEPARATION_STATUS.VIOLATION;
  } else if (actual.lateral < required.lateral.required * MARGINAL_THRESHOLD) {
    lateralStatus = SEPARATION_STATUS.MARGINAL;
  }

  // Calculate vertical status
  let verticalStatus = SEPARATION_STATUS.ADEQUATE;
  if (actual.vertical != null) {
    if (actual.vertical < required.vertical.required) {
      verticalStatus = SEPARATION_STATUS.VIOLATION;
    } else if (actual.vertical < required.vertical.required * MARGINAL_THRESHOLD) {
      verticalStatus = SEPARATION_STATUS.MARGINAL;
    }
  }

  // Overall status is the worst of the two
  let overallStatus = SEPARATION_STATUS.ADEQUATE;
  if (lateralStatus === SEPARATION_STATUS.VIOLATION || verticalStatus === SEPARATION_STATUS.VIOLATION) {
    overallStatus = SEPARATION_STATUS.VIOLATION;
  } else if (lateralStatus === SEPARATION_STATUS.MARGINAL || verticalStatus === SEPARATION_STATUS.MARGINAL) {
    overallStatus = SEPARATION_STATUS.MARGINAL;
  }

  return {
    lateral: lateralStatus,
    vertical: verticalStatus,
    overall: overallStatus,
  };
}

/**
 * Get color for separation status (for UI display)
 *
 * @param {string} status - Separation status code
 * @returns {Object} Color configuration { fill, stroke, text }
 */
export function getSeparationColor(status) {
  switch (status) {
    case SEPARATION_STATUS.VIOLATION:
      return {
        fill: 'rgba(255, 80, 80, 0.3)',
        stroke: 'rgba(255, 80, 80, 0.9)',
        text: 'rgba(255, 100, 100, 1)',
        name: 'red',
      };
    case SEPARATION_STATUS.MARGINAL:
      return {
        fill: 'rgba(255, 200, 0, 0.3)',
        stroke: 'rgba(255, 200, 0, 0.9)',
        text: 'rgba(255, 220, 100, 1)',
        name: 'yellow',
      };
    case SEPARATION_STATUS.ADEQUATE:
    default:
      return {
        fill: 'rgba(0, 200, 100, 0.3)',
        stroke: 'rgba(0, 200, 100, 0.9)',
        text: 'rgba(100, 255, 150, 1)',
        name: 'green',
      };
  }
}

/**
 * Comprehensive separation check between two aircraft
 *
 * @param {Object} aircraft1 - First aircraft with position and altitude
 * @param {Object} aircraft2 - Second aircraft with position and altitude
 * @param {Object} options - Optional configuration
 * @param {number} options.radarLat - Radar site latitude for distance calculation
 * @param {number} options.radarLon - Radar site longitude for distance calculation
 * @returns {Object} Complete separation analysis
 */
export function checkSeparation(aircraft1, aircraft2, options = {}) {
  if (!aircraft1 || !aircraft2) return null;

  const { radarLat, radarLon } = options;

  // Calculate distance from radar (use midpoint between aircraft)
  let distanceFromRadar = 0;
  if (radarLat != null && radarLon != null) {
    const midLat = (aircraft1.lat + aircraft2.lat) / 2;
    const midLon = (aircraft1.lon + aircraft2.lon) / 2;
    distanceFromRadar = calculateDistanceNm(radarLat, radarLon, midLat, midLon);
  }

  // Get required separation
  const required = getRequiredSeparation(aircraft1, aircraft2, distanceFromRadar);

  // Calculate actual separation
  const actual = calculateSeparation(aircraft1, aircraft2);
  if (!actual) return null;

  // Determine status
  const status = getSeparationStatus(actual, required);

  // Get color based on overall status
  const color = getSeparationColor(status?.overall);

  // Calculate bearing between aircraft
  const dLon = aircraft2.lon - aircraft1.lon;
  const dLat = aircraft2.lat - aircraft1.lat;
  const bearing = ((Math.atan2(
    dLon * Math.cos((aircraft1.lat * Math.PI) / 180),
    dLat
  ) * 180) / Math.PI + 360) % 360;

  return {
    aircraft1: {
      hex: aircraft1.hex,
      callsign: aircraft1.flight?.trim() || aircraft1.hex?.toUpperCase(),
      altitude: aircraft1.alt_baro ?? aircraft1.altitude,
    },
    aircraft2: {
      hex: aircraft2.hex,
      callsign: aircraft2.flight?.trim() || aircraft2.hex?.toUpperCase(),
      altitude: aircraft2.alt_baro ?? aircraft2.altitude,
    },
    actual,
    required,
    status,
    color,
    bearing: bearing.toFixed(0),
    distanceFromRadar: distanceFromRadar.toFixed(1),
  };
}

/**
 * Format separation data for display
 *
 * @param {Object} separationData - Result from checkSeparation()
 * @returns {Object} Formatted strings for UI display
 */
export function formatSeparationDisplay(separationData) {
  if (!separationData) return null;

  const { actual, required, status } = separationData;

  return {
    lateral: {
      actual: actual.lateralFormatted,
      required: `${required.lateral.required} nm min`,
      status: status.lateral,
      statusText: status.lateral.charAt(0).toUpperCase() + status.lateral.slice(1),
      type: required.lateral.description,
    },
    vertical: {
      actual: actual.verticalFormatted,
      required: `${required.vertical.required.toLocaleString()} ft min`,
      status: status.vertical,
      statusText: status.vertical.charAt(0).toUpperCase() + status.vertical.slice(1),
      type: required.vertical.description,
    },
    overall: {
      status: status.overall,
      statusText: status.overall.charAt(0).toUpperCase() + status.overall.slice(1),
    },
  };
}

export default {
  FL290_FEET,
  TERMINAL_RADAR_RANGE_NM,
  SEPARATION_STATUS,
  calculateDistanceNm,
  calculateVerticalSeparation,
  getRequiredLateralSeparation,
  getRequiredVerticalSeparation,
  getRequiredSeparation,
  calculateSeparation,
  getSeparationStatus,
  getSeparationColor,
  checkSeparation,
  formatSeparationDisplay,
};
