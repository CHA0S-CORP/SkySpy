/**
 * Client-side alert rule evaluation utilities.
 * Mirrors the backend evaluation logic in adsb-api/app/services/alerts.py
 */

import {
  identifyLawEnforcement,
  isHelicopter as checkIsHelicopter,
} from './lawEnforcement';

/**
 * Safely parse altitude value.
 * @param {*} value - Altitude value (may be number, string, or null)
 * @returns {number|null} Parsed altitude or null
 */
function safeIntAltitude(value) {
  if (value === null || value === undefined || value === '' || value === 'ground') {
    return null;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Evaluate a single condition against an aircraft.
 * @param {Object} condition - The condition to evaluate
 * @param {Object} aircraft - Aircraft data object
 * @param {number|null} distanceNm - Optional distance in nautical miles
 * @returns {boolean} Whether the condition matches
 */
export function evaluateCondition(condition, aircraft, distanceNm = null) {
  if (!condition || !aircraft) return false;

  const condType = (condition.type || '').toLowerCase();
  const operator = (condition.operator || 'equals').toLowerCase();
  const value = String(condition.value || '').toUpperCase();

  // Helper to normalize operator names (frontend uses different names than backend)
  const normalizeOperator = (op) => {
    const map = {
      'equals': 'eq',
      'eq': 'eq',
      'not_equals': 'neq',
      'neq': 'neq',
      'contains': 'contains',
      'starts_with': 'startswith',
      'startswith': 'startswith',
      'ends_with': 'endswith',
      'endswith': 'endswith',
      'greater_than': 'gt',
      'gt': 'gt',
      'less_than': 'lt',
      'lt': 'lt',
      'gte': 'gte',
      'lte': 'lte',
    };
    return map[op] || 'eq';
  };

  const op = normalizeOperator(operator);

  // String comparison helper
  const stringMatch = (acVal, targetVal, op) => {
    const acUpper = (acVal || '').toUpperCase().trim();
    const targetUpper = (targetVal || '').toUpperCase().trim();

    switch (op) {
      case 'eq':
      case 'equals':
        return acUpper === targetUpper;
      case 'neq':
      case 'not_equals':
        return acUpper !== targetUpper;
      case 'contains':
        return acUpper.includes(targetUpper);
      case 'startswith':
      case 'starts_with':
        return acUpper.startsWith(targetUpper);
      case 'endswith':
      case 'ends_with':
        return acUpper.endsWith(targetUpper);
      default:
        return acUpper === targetUpper;
    }
  };

  // Numeric comparison helper
  const numericMatch = (acVal, targetVal, op) => {
    if (acVal === null || acVal === undefined) return false;
    const targetNum = parseFloat(targetVal);
    if (isNaN(targetNum)) return false;

    switch (op) {
      case 'lt':
      case 'less_than':
        return acVal < targetNum;
      case 'gt':
      case 'greater_than':
        return acVal > targetNum;
      case 'lte':
        return acVal <= targetNum;
      case 'gte':
        return acVal >= targetNum;
      case 'eq':
      case 'equals':
        return acVal === targetNum;
      case 'neq':
      case 'not_equals':
        return acVal !== targetNum;
      default:
        return acVal === targetNum;
    }
  };

  switch (condType) {
    case 'icao':
    case 'hex': {
      const acVal = aircraft.hex || '';
      return stringMatch(acVal, value, op);
    }

    case 'callsign': {
      const acVal = aircraft.flight || aircraft.callsign || '';
      return stringMatch(acVal, value, op);
    }

    case 'squawk': {
      const acVal = aircraft.squawk || '';
      return stringMatch(acVal, value, op);
    }

    case 'altitude':
    case 'altitude_above': {
      const alt = safeIntAltitude(aircraft.alt_baro) || safeIntAltitude(aircraft.alt_geom) || safeIntAltitude(aircraft.alt);
      if (alt === null) return false;
      // altitude_above means altitude > threshold
      if (condType === 'altitude_above') {
        return alt > parseFloat(value);
      }
      return numericMatch(alt, value, op);
    }

    case 'altitude_below': {
      const alt = safeIntAltitude(aircraft.alt_baro) || safeIntAltitude(aircraft.alt_geom) || safeIntAltitude(aircraft.alt);
      if (alt === null) return false;
      // altitude_below means altitude < threshold
      return alt < parseFloat(value);
    }

    case 'speed':
    case 'speed_above': {
      const gs = aircraft.gs;
      if (gs === null || gs === undefined) return false;
      // speed_above means speed > threshold
      if (condType === 'speed_above') {
        return gs > parseFloat(value);
      }
      return numericMatch(gs, value, op);
    }

    case 'speed_below': {
      const gs = aircraft.gs;
      if (gs === null || gs === undefined) return false;
      // speed_below means speed < threshold
      return gs < parseFloat(value);
    }

    case 'vertical_rate': {
      const vr = aircraft.baro_rate || aircraft.geom_rate || aircraft.vr;
      if (vr === null || vr === undefined) return false;
      return numericMatch(vr, value, op);
    }

    case 'distance_within':
    case 'proximity': {
      const dist = distanceNm ?? aircraft.distance_nm;
      // Check for null, undefined, and NaN
      if (dist == null || typeof dist !== 'number' || isNaN(dist)) return false;
      const threshold = parseFloat(value);
      if (isNaN(threshold)) return false;
      // distance_within means distance <= threshold
      if (condType === 'distance_within') {
        return dist <= threshold;
      }
      // proximity type can use different operators
      if (op === 'lt' || op === 'lte') {
        return dist <= threshold;
      }
      if (op === 'gt' || op === 'gte') {
        return dist >= threshold;
      }
      return dist <= threshold;
    }

    case 'category': {
      const acVal = aircraft.category || '';
      return stringMatch(acVal, value, op);
    }

    case 'military': {
      // Check military flag or dbFlags bit 1
      const isMilitary = aircraft.military || Boolean((aircraft.dbFlags || 0) & 1);
      // If no value specified or value is true/yes/1, check for military
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isMilitary === expected;
    }

    case 'emergency': {
      // Emergency squawk codes: 7500 (hijack), 7600 (radio failure), 7700 (emergency)
      const squawk = aircraft.squawk || '';
      const isEmergency = ['7500', '7600', '7700'].includes(squawk) || aircraft.emergency === true;
      // If no value specified or value is true/yes/1, check for emergency
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isEmergency === expected;
    }

    case 'aircraft_type':
    case 'type': {
      const acType = aircraft.t || aircraft.type || '';
      return stringMatch(acType, value, op);
    }

    case 'registration': {
      const acVal = aircraft.r || aircraft.registration || '';
      return stringMatch(acVal, value, op);
    }

    case 'operator': {
      const acVal = aircraft.ownOp || aircraft.operator || '';
      return stringMatch(acVal, value, op);
    }

    case 'law_enforcement': {
      // Use law enforcement detection from lawEnforcement.js
      const leInfo = identifyLawEnforcement(aircraft);
      const isLE = leInfo.isLawEnforcement;
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isLE === expected;
    }

    case 'helicopter': {
      // Check if aircraft is a helicopter
      const category = aircraft.category || '';
      const typeCode = aircraft.t || aircraft.type || '';
      const isHeli = checkIsHelicopter(category, typeCode);
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isHeli === expected;
    }

    case 'distance_from_mobile': {
      // Distance from mobile device position - requires mobileDistanceNm to be passed
      // For now, fall back to regular distance if available
      const dist = aircraft.mobileDistanceNm ?? distanceNm ?? aircraft.distance_nm;
      if (dist === null || dist === undefined) return false;
      const threshold = parseFloat(value);
      if (isNaN(threshold)) return false;
      return dist <= threshold;
    }

    default:
      return false;
  }
}

/**
 * Evaluate a group of conditions with AND/OR logic.
 * @param {Object} group - Condition group with conditions array and logic
 * @param {Object} aircraft - Aircraft data object
 * @param {number|null} distanceNm - Optional distance in nautical miles
 * @returns {boolean} Whether the group matches
 */
export function evaluateConditionGroup(group, aircraft, distanceNm = null) {
  if (!group || !aircraft) return false;

  const conditions = group.conditions || [];
  const logic = (group.logic || 'AND').toUpperCase();

  if (conditions.length === 0) return false;

  if (logic === 'OR') {
    return conditions.some(c => evaluateCondition(c, aircraft, distanceNm));
  }
  // Default to AND
  return conditions.every(c => evaluateCondition(c, aircraft, distanceNm));
}

/**
 * Evaluate if an aircraft matches a rule.
 * Supports both complex conditions (with groups) and simple flat conditions array.
 * @param {Object} rule - Alert rule object
 * @param {Object} aircraft - Aircraft data object
 * @param {number|null} distanceNm - Optional distance in nautical miles
 * @returns {boolean} Whether the rule matches
 */
export function evaluateRule(rule, aircraft, distanceNm = null) {
  if (!rule || !aircraft) return false;

  const conditions = rule.conditions;

  // Complex conditions with groups
  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    const groups = conditions.groups || [];
    const logic = (conditions.logic || 'AND').toUpperCase();

    if (groups.length > 0) {
      if (logic === 'OR') {
        return groups.some(g => evaluateConditionGroup(g, aircraft, distanceNm));
      }
      // Default to AND
      return groups.every(g => evaluateConditionGroup(g, aircraft, distanceNm));
    }
  }

  // Simple flat array of conditions (AND logic)
  if (Array.isArray(conditions) && conditions.length > 0) {
    return conditions.every(c => evaluateCondition(c, aircraft, distanceNm));
  }

  // Legacy single condition format
  if (rule.rule_type || rule.type) {
    return evaluateCondition({
      type: rule.rule_type || rule.type,
      operator: rule.operator,
      value: rule.value,
    }, aircraft, distanceNm);
  }

  return false;
}

/**
 * Find all aircraft that match a rule.
 * @param {Object} rule - Alert rule object
 * @param {Array} aircraftList - Array of aircraft objects
 * @param {Object|null} feederLocation - Optional feeder location for distance calculations
 * @returns {Array} Array of matching aircraft with match details
 */
export function findMatchingAircraft(rule, aircraftList, feederLocation = null) {
  if (!rule || !Array.isArray(aircraftList)) return [];

  const matches = [];

  for (const aircraft of aircraftList) {
    // Calculate distance if feeder location is provided
    let distanceNm = aircraft.distance_nm;
    if (!distanceNm && feederLocation && aircraft.lat && aircraft.lon) {
      distanceNm = calculateDistanceNm(
        feederLocation.lat,
        feederLocation.lon,
        aircraft.lat,
        aircraft.lon
      );
    }

    if (evaluateRule(rule, aircraft, distanceNm)) {
      // Determine which conditions matched for the aircraft
      const matchReasons = getMatchReasons(rule, aircraft, distanceNm);
      matches.push({
        ...aircraft,
        matchReasons,
        calculatedDistance: distanceNm,
      });
    }
  }

  return matches;
}

/**
 * Get human-readable reasons for why an aircraft matched a rule.
 * @param {Object} rule - Alert rule object
 * @param {Object} aircraft - Aircraft data object
 * @param {number|null} distanceNm - Optional distance in nautical miles
 * @returns {Array} Array of reason strings
 */
export function getMatchReasons(rule, aircraft, distanceNm = null) {
  const reasons = [];
  const conditions = rule.conditions;

  const checkCondition = (c) => {
    if (!evaluateCondition(c, aircraft, distanceNm)) return;

    const type = (c.type || '').toLowerCase();
    const value = c.value;
    const operator = c.operator || 'equals';

    switch (type) {
      case 'callsign':
        reasons.push(`Callsign ${operator} "${value}" (${aircraft.flight || 'N/A'})`);
        break;
      case 'hex':
      case 'icao':
        reasons.push(`ICAO ${operator} "${value}" (${aircraft.hex || 'N/A'})`);
        break;
      case 'squawk':
        reasons.push(`Squawk ${operator} "${value}" (${aircraft.squawk || 'N/A'})`);
        break;
      case 'altitude_above':
        reasons.push(`Altitude above ${value}ft (${aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 'N/A'}ft)`);
        break;
      case 'altitude_below':
        reasons.push(`Altitude below ${value}ft (${aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 'N/A'}ft)`);
        break;
      case 'speed_above':
        reasons.push(`Speed above ${value}kts (${aircraft.gs || 'N/A'}kts)`);
        break;
      case 'speed_below':
        reasons.push(`Speed below ${value}kts (${aircraft.gs || 'N/A'}kts)`);
        break;
      case 'distance_within':
        reasons.push(`Within ${value}nm (${distanceNm?.toFixed(1) || aircraft.distance_nm?.toFixed(1) || 'N/A'}nm)`);
        break;
      case 'military':
        reasons.push('Military aircraft');
        break;
      case 'emergency':
        reasons.push(`Emergency (squawk: ${aircraft.squawk || 'N/A'})`);
        break;
      case 'type':
      case 'aircraft_type':
        reasons.push(`Aircraft type ${operator} "${value}" (${aircraft.t || aircraft.type || 'N/A'})`);
        break;
      case 'law_enforcement':
        reasons.push('Law enforcement aircraft');
        break;
      case 'helicopter':
        reasons.push('Helicopter');
        break;
      case 'distance_from_mobile':
        reasons.push(`Within ${value}nm from mobile (${aircraft.mobileDistanceNm?.toFixed(1) || distanceNm?.toFixed(1) || 'N/A'}nm)`);
        break;
      default:
        reasons.push(`${type} ${operator} "${value}"`);
    }
  };

  // Handle complex conditions with groups
  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    const groups = conditions.groups || [];
    for (const group of groups) {
      for (const c of (group.conditions || [])) {
        checkCondition(c);
      }
    }
  }

  // Handle simple flat array of conditions
  if (Array.isArray(conditions)) {
    for (const c of conditions) {
      checkCondition(c);
    }
  }

  // Handle legacy single condition
  if (rule.rule_type || rule.type) {
    checkCondition({
      type: rule.rule_type || rule.type,
      operator: rule.operator,
      value: rule.value,
    });
  }

  return reasons.length > 0 ? reasons : ['Matches rule conditions'];
}

/**
 * Calculate distance in nautical miles between two lat/lon points.
 * Uses Haversine formula.
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in nautical miles
 */
export function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth's radius in nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Get relevant aircraft values based on rule conditions for display.
 * @param {Object} rule - Alert rule object
 * @param {Object} aircraft - Aircraft data object
 * @returns {Object} Object with relevant field values
 */
export function getRelevantValues(rule, aircraft) {
  const values = {
    callsign: aircraft.flight || aircraft.callsign || null,
    hex: aircraft.hex,
  };

  const conditions = rule.conditions;

  const extractTypes = (conditionsList) => {
    if (!Array.isArray(conditionsList)) return;
    for (const c of conditionsList) {
      const type = (c.type || '').toLowerCase();
      switch (type) {
        case 'altitude_above':
        case 'altitude_below':
        case 'altitude':
          values.altitude = aircraft.alt_baro || aircraft.alt_geom || aircraft.alt;
          break;
        case 'speed_above':
        case 'speed_below':
        case 'speed':
          values.speed = aircraft.gs;
          break;
        case 'distance_within':
        case 'proximity':
          values.distance = aircraft.distance_nm;
          break;
        case 'squawk':
          values.squawk = aircraft.squawk;
          break;
        case 'type':
        case 'aircraft_type':
          values.type = aircraft.t || aircraft.type;
          break;
        case 'military':
          values.military = aircraft.military || Boolean((aircraft.dbFlags || 0) & 1);
          break;
        case 'emergency':
          values.emergency = ['7500', '7600', '7700'].includes(aircraft.squawk || '') || aircraft.emergency;
          break;
        case 'law_enforcement':
          const leInfo = identifyLawEnforcement(aircraft);
          values.lawEnforcement = leInfo.isLawEnforcement;
          values.leCategory = leInfo.category;
          break;
        case 'helicopter':
          const category = aircraft.category || '';
          const typeCode = aircraft.t || aircraft.type || '';
          values.helicopter = checkIsHelicopter(category, typeCode);
          break;
        case 'distance_from_mobile':
          values.mobileDistance = aircraft.mobileDistanceNm;
          break;
      }
    }
  };

  // Handle complex conditions with groups
  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    const groups = conditions.groups || [];
    for (const group of groups) {
      extractTypes(group.conditions || []);
    }
  }

  // Handle simple flat array
  if (Array.isArray(conditions)) {
    extractTypes(conditions);
  }

  return values;
}

export default {
  evaluateCondition,
  evaluateConditionGroup,
  evaluateRule,
  findMatchingAircraft,
  getMatchReasons,
  getRelevantValues,
  calculateDistanceNm,
};
