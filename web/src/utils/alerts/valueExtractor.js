/**
 * Value extraction utilities for alert evaluation
 */

/**
 * Safely parse altitude value.
 * @param {*} value - Altitude value (may be number, string, or null)
 * @returns {number|null} Parsed altitude or null
 */
export function safeIntAltitude(value) {
  if (value === null || value === undefined || value === '' || value === 'ground') {
    return null;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Get altitude from aircraft data (checks multiple fields)
 */
export function getAircraftAltitude(aircraft) {
  return safeIntAltitude(aircraft.alt_baro) ||
         safeIntAltitude(aircraft.alt_geom) ||
         safeIntAltitude(aircraft.alt);
}

/**
 * Get vertical rate from aircraft data (checks multiple fields)
 */
export function getAircraftVerticalRate(aircraft) {
  return aircraft.baro_rate || aircraft.geom_rate || aircraft.vr;
}

/**
 * Get aircraft type from aircraft data (checks multiple fields)
 */
export function getAircraftType(aircraft) {
  return aircraft.t || aircraft.type || '';
}

/**
 * Check if squawk is an emergency code
 */
export function isEmergencySquawk(squawk) {
  return ['7500', '7600', '7700'].includes(squawk || '');
}

/**
 * Check if aircraft has emergency status
 */
export function isAircraftEmergency(aircraft) {
  return isEmergencySquawk(aircraft.squawk) || aircraft.emergency === true;
}

/**
 * Check if aircraft is military
 */
export function isAircraftMilitary(aircraft) {
  return aircraft.military || Boolean((aircraft.dbFlags || 0) & 1);
}
