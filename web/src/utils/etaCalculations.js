/**
 * ETA Calculations Utility
 * Phase 11.2 Implementation - Pro Mode ETA Calculations
 *
 * Calculates estimated time of arrival from aircraft to target points:
 * - User-clicked map points
 * - Nearby airports
 * - Any geographic coordinate
 *
 * Based on ground speed and direct distance (great circle).
 */

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Start latitude
 * @param {number} lon1 - Start longitude
 * @param {number} lat2 - End latitude
 * @param {number} lon2 - End longitude
 * @returns {number} Distance in nautical miles
 */
export function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate bearing from point 1 to point 2
 * @param {number} lat1 - Start latitude
 * @param {number} lon1 - Start longitude
 * @param {number} lat2 - End latitude
 * @param {number} lon2 - End longitude
 * @returns {number} Bearing in degrees (0-360)
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Calculate ETA from aircraft to target point
 * @param {Object} aircraft - Aircraft object with lat, lon, gs (ground speed in knots), track
 * @param {Object} target - Target point with lat, lon
 * @returns {Object} ETA data:
 *   - distanceNm: Distance in nautical miles
 *   - bearing: Bearing to target in degrees
 *   - etaSeconds: ETA in seconds (null if aircraft not moving toward target)
 *   - etaMinutes: ETA in minutes
 *   - isApproaching: Whether aircraft is moving toward target
 *   - closingSpeed: Effective speed toward target in knots
 */
export function calculateETAToPoint(aircraft, target) {
  if (!aircraft?.lat || !aircraft?.lon || !target?.lat || !target?.lon) {
    return {
      distanceNm: null,
      bearing: null,
      etaSeconds: null,
      etaMinutes: null,
      isApproaching: false,
      closingSpeed: null,
    };
  }

  // Calculate distance and bearing to target
  const distanceNm = calculateDistanceNm(aircraft.lat, aircraft.lon, target.lat, target.lon);
  const bearingToTarget = calculateBearing(aircraft.lat, aircraft.lon, target.lat, target.lon);

  // Get aircraft ground speed and track
  const groundSpeed = aircraft.gs || aircraft.ground_speed || 0;
  const aircraftTrack = aircraft.track ?? aircraft.true_heading ?? aircraft.heading ?? 0;

  // If aircraft is stationary, no ETA
  if (groundSpeed < 10) {
    return {
      distanceNm: Math.round(distanceNm * 10) / 10,
      bearing: Math.round(bearingToTarget),
      etaSeconds: null,
      etaMinutes: null,
      isApproaching: false,
      closingSpeed: 0,
    };
  }

  // Calculate angle difference between aircraft track and bearing to target
  let angleDiff = bearingToTarget - aircraftTrack;
  if (angleDiff > 180) angleDiff -= 360;
  if (angleDiff < -180) angleDiff += 360;

  // Calculate closing speed (component of velocity toward target)
  // closingSpeed = groundSpeed * cos(angleDiff)
  const closingSpeed = groundSpeed * Math.cos((angleDiff * Math.PI) / 180);

  // If not approaching target (angle > 90 degrees), no meaningful ETA
  const isApproaching = closingSpeed > 5; // At least 5 knots toward target

  if (!isApproaching) {
    return {
      distanceNm: Math.round(distanceNm * 10) / 10,
      bearing: Math.round(bearingToTarget),
      etaSeconds: null,
      etaMinutes: null,
      isApproaching: false,
      closingSpeed: Math.round(closingSpeed),
    };
  }

  // Calculate ETA: time = distance / speed
  // ETA in hours = distance (nm) / closing speed (knots)
  const etaHours = distanceNm / closingSpeed;
  const etaSeconds = Math.round(etaHours * 3600);
  const etaMinutes = Math.round(etaHours * 60);

  // Cap ETA at 2 hours (7200 seconds) for practicality
  if (etaSeconds > 7200) {
    return {
      distanceNm: Math.round(distanceNm * 10) / 10,
      bearing: Math.round(bearingToTarget),
      etaSeconds: null,
      etaMinutes: null,
      isApproaching: true,
      closingSpeed: Math.round(closingSpeed),
    };
  }

  return {
    distanceNm: Math.round(distanceNm * 10) / 10,
    bearing: Math.round(bearingToTarget),
    etaSeconds,
    etaMinutes,
    isApproaching: true,
    closingSpeed: Math.round(closingSpeed),
  };
}

/**
 * Calculate ETA to multiple airports from aircraft
 * @param {Object} aircraft - Aircraft object with lat, lon, gs, track
 * @param {Array} airports - Array of airport objects with lat, lon, icao/name
 * @param {Object} options - Options: maxDistance (nm), maxResults
 * @returns {Array} Array of airport ETA data sorted by distance
 */
export function calculateETAToNearbyAirports(aircraft, airports, options = {}) {
  const { maxDistance = 100, maxResults = 5 } = options;

  if (!aircraft?.lat || !aircraft?.lon || !airports?.length) {
    return [];
  }

  const airportETAs = airports
    .map((airport) => {
      if (!airport?.lat || !airport?.lon) return null;

      const eta = calculateETAToPoint(aircraft, airport);

      return {
        ...airport,
        ...eta,
        id: airport.icao || airport.icaoId || airport.faaId || airport.id || airport.name,
      };
    })
    .filter((apt) => apt && apt.distanceNm !== null && apt.distanceNm <= maxDistance)
    .sort((a, b) => a.distanceNm - b.distanceNm)
    .slice(0, maxResults);

  return airportETAs;
}

/**
 * Format ETA for display
 * @param {number} seconds - ETA in seconds
 * @returns {string} Formatted string (e.g., "2:30", "45s", "--")
 */
export function formatETA(seconds) {
  if (seconds === null || seconds === undefined) {
    return '--';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h${mins > 0 ? mins + 'm' : ''}`;
  }

  if (secs === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m${secs}s`;
}

/**
 * Format ETA with more detail for tooltips
 * @param {number} seconds - ETA in seconds
 * @returns {string} Detailed formatted string
 */
export function formatETADetailed(seconds) {
  if (seconds === null || seconds === undefined) {
    return 'N/A';
  }

  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return `${hours}h ${mins}m`;
  }

  if (secs === 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }

  return `${minutes}m ${secs}s`;
}

/**
 * Get ETA urgency level based on time
 * @param {number} seconds - ETA in seconds
 * @returns {string} 'critical' | 'warning' | 'info' | null
 */
export function getETAUrgency(seconds) {
  if (seconds === null || seconds === undefined) {
    return null;
  }

  if (seconds < 60) return 'critical';
  if (seconds < 300) return 'warning';
  if (seconds < 900) return 'info';
  return null;
}

/**
 * Cardinal direction from bearing
 * @param {number} bearing - Bearing in degrees
 * @returns {string} Cardinal direction (N, NE, E, etc.)
 */
export function bearingToCardinal(bearing) {
  const directions = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

/**
 * Calculate predicted position at ETA
 * @param {Object} aircraft - Aircraft with lat, lon, gs, track
 * @param {number} seconds - Time in future
 * @returns {Object} {lat, lon} predicted position
 */
export function calculatePredictedPosition(aircraft, seconds) {
  if (!aircraft?.lat || !aircraft?.lon || !seconds) {
    return { lat: aircraft?.lat, lon: aircraft?.lon };
  }

  const groundSpeed = aircraft.gs || aircraft.ground_speed || 0;
  const track = aircraft.track ?? aircraft.true_heading ?? aircraft.heading ?? 0;

  if (groundSpeed < 10) {
    return { lat: aircraft.lat, lon: aircraft.lon };
  }

  // Distance traveled in nautical miles
  const distanceNm = (groundSpeed * seconds) / 3600;

  // Convert to lat/lon change
  const R = 3440.065; // Earth radius in nm
  const d = distanceNm / R;
  const brng = (track * Math.PI) / 180;
  const lat1 = (aircraft.lat * Math.PI) / 180;
  const lon1 = (aircraft.lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (lon2 * 180) / Math.PI,
  };
}

export default {
  calculateDistanceNm,
  calculateBearing,
  calculateETAToPoint,
  calculateETAToNearbyAirports,
  formatETA,
  formatETADetailed,
  getETAUrgency,
  bearingToCardinal,
  calculatePredictedPosition,
};
