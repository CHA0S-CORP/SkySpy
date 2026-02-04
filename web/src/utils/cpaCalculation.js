/**
 * Closest Point of Approach (CPA) Calculation Utility
 * Phase 3.1 Implementation - Pro Radar Mode
 *
 * Calculates the time, position, and distance at which two aircraft
 * will be closest to each other based on their current positions,
 * tracks (headings), and ground speeds.
 */

/**
 * Calculate the Closest Point of Approach between two aircraft
 *
 * @param {Object} ac1 - First aircraft object with lat, lon, track (degrees), gs (knots)
 * @param {Object} ac2 - Second aircraft object with lat, lon, track (degrees), gs (knots)
 * @returns {Object} CPA data including:
 *   - tCPASeconds: Time to CPA in seconds (0 if CPA is now or past)
 *   - cpa1: {lat, lon} - Position of ac1 at CPA
 *   - cpa2: {lat, lon} - Position of ac2 at CPA
 *   - distanceAtCPA: Distance between aircraft at CPA in nautical miles
 *   - isPast: Boolean indicating if CPA has already occurred
 */
export function calculateCPA(ac1, ac2) {
  // Relative position in nautical miles
  // Using spherical approximation for short distances
  const dx = (ac2.lon - ac1.lon) * 60 * Math.cos(((ac1.lat + ac2.lat) / 2) * Math.PI / 180);
  const dy = (ac2.lat - ac1.lat) * 60;

  // Convert track (heading in degrees) and groundspeed to velocity components
  // Track: 0 = North, 90 = East, 180 = South, 270 = West
  const track1 = (ac1.track || 0) * Math.PI / 180;
  const track2 = (ac2.track || 0) * Math.PI / 180;
  const gs1 = ac1.gs || 0;
  const gs2 = ac2.gs || 0;

  // Velocity components in nm/hour (East and North)
  // v_east = gs * sin(track), v_north = gs * cos(track)
  const v1x = gs1 * Math.sin(track1);
  const v1y = gs1 * Math.cos(track1);
  const v2x = gs2 * Math.sin(track2);
  const v2y = gs2 * Math.cos(track2);

  // Relative velocity (ac2 relative to ac1)
  const dvx = v2x - v1x;
  const dvy = v2y - v1y;

  // Magnitude squared of relative velocity
  const dvMagSq = dvx * dvx + dvy * dvy;

  // Current distance
  const currentDistance = Math.sqrt(dx * dx + dy * dy);

  // If aircraft are not moving relative to each other (parallel tracks, same speed),
  // CPA is the current moment
  if (dvMagSq < 0.001) {
    return {
      tCPASeconds: 0,
      cpa1: { lat: ac1.lat, lon: ac1.lon },
      cpa2: { lat: ac2.lat, lon: ac2.lon },
      distanceAtCPA: currentDistance,
      isPast: false,
      isParallel: true
    };
  }

  // Time to CPA in hours
  // Derived from: d(distance^2)/dt = 0
  // t_CPA = -(dx * dvx + dy * dvy) / (dvx^2 + dvy^2)
  const tCPA = -(dx * dvx + dy * dvy) / dvMagSq;
  const tCPASeconds = tCPA * 3600; // Convert to seconds

  // If CPA is in the past (tCPA < 0), aircraft are diverging
  if (tCPA < 0) {
    return {
      tCPASeconds: 0,
      cpa1: { lat: ac1.lat, lon: ac1.lon },
      cpa2: { lat: ac2.lat, lon: ac2.lon },
      distanceAtCPA: currentDistance,
      isPast: true,
      isParallel: false
    };
  }

  // Calculate CPA positions
  // Position = current + velocity * time
  // Convert velocity (nm/hour) to degrees for lat/lon update
  const cpa1Lat = ac1.lat + (v1y * tCPA) / 60;
  const cpa1Lon = ac1.lon + (v1x * tCPA) / (60 * Math.cos(ac1.lat * Math.PI / 180));
  const cpa2Lat = ac2.lat + (v2y * tCPA) / 60;
  const cpa2Lon = ac2.lon + (v2x * tCPA) / (60 * Math.cos(ac2.lat * Math.PI / 180));

  // Calculate distance at CPA
  const cpaDx = (cpa2Lon - cpa1Lon) * 60 * Math.cos(((cpa1Lat + cpa2Lat) / 2) * Math.PI / 180);
  const cpaDy = (cpa2Lat - cpa1Lat) * 60;
  const distanceAtCPA = Math.sqrt(cpaDx * cpaDx + cpaDy * cpaDy);

  return {
    tCPASeconds,
    cpa1: { lat: cpa1Lat, lon: cpa1Lon },
    cpa2: { lat: cpa2Lat, lon: cpa2Lon },
    distanceAtCPA,
    isPast: false,
    isParallel: false
  };
}

/**
 * Format time to CPA as a human-readable string
 *
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string (e.g., "45s", "2m30s")
 */
export function formatTimeToCPA(seconds) {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
}

/**
 * Determine if a CPA is critical based on time threshold
 *
 * @param {number} tCPASeconds - Time to CPA in seconds
 * @param {number} threshold - Critical threshold in seconds (default 30)
 * @returns {boolean} True if CPA is critical
 */
export function isCriticalCPA(tCPASeconds, threshold = 30) {
  return tCPASeconds > 0 && tCPASeconds < threshold;
}

/**
 * Get the midpoint between two CPA positions (for marker placement)
 *
 * @param {Object} cpa1 - {lat, lon} of first aircraft at CPA
 * @param {Object} cpa2 - {lat, lon} of second aircraft at CPA
 * @returns {Object} {lat, lon} midpoint
 */
export function getCPAMidpoint(cpa1, cpa2) {
  return {
    lat: (cpa1.lat + cpa2.lat) / 2,
    lon: (cpa1.lon + cpa2.lon) / 2
  };
}

export default {
  calculateCPA,
  formatTimeToCPA,
  isCriticalCPA,
  getCPAMidpoint
};
