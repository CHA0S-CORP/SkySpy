/**
 * Client-side alert rule evaluation utilities.
 * Mirrors the backend evaluation logic in adsb-api/app/services/alerts.py
 */

import {
  identifyLawEnforcement,
  isHelicopter as checkIsHelicopter,
} from './lawEnforcement';
import {
  normalizeOperator,
  stringMatch,
  numericMatch,
  calculateDistanceNm,
  safeIntAltitude,
  isAircraftEmergency,
  isAircraftMilitary,
} from './alerts';

// Re-export for backwards compatibility
export { calculateDistanceNm } from './alerts';

/**
 * Evaluate a single condition against an aircraft.
 */
export function evaluateCondition(condition, aircraft, distanceNm = null) {
  if (!condition || !aircraft) return false;

  const condType = (condition.type || '').toLowerCase();
  const operator = (condition.operator || 'equals').toLowerCase();
  const value = String(condition.value || '').toUpperCase();
  const op = normalizeOperator(operator);

  switch (condType) {
    case 'icao':
    case 'hex':
      return stringMatch(aircraft.hex || '', value, op);

    case 'callsign':
      return stringMatch(aircraft.flight || aircraft.callsign || '', value, op);

    case 'squawk':
      return stringMatch(aircraft.squawk || '', value, op);

    case 'altitude':
    case 'altitude_above': {
      const alt = safeIntAltitude(aircraft.alt_baro) || safeIntAltitude(aircraft.alt_geom) || safeIntAltitude(aircraft.alt);
      if (alt === null) return false;
      if (condType === 'altitude_above') return alt > parseFloat(value);
      return numericMatch(alt, value, op);
    }

    case 'altitude_below': {
      const alt = safeIntAltitude(aircraft.alt_baro) || safeIntAltitude(aircraft.alt_geom) || safeIntAltitude(aircraft.alt);
      if (alt === null) return false;
      return alt < parseFloat(value);
    }

    case 'speed':
    case 'speed_above': {
      const gs = aircraft.gs;
      if (gs === null || gs === undefined) return false;
      if (condType === 'speed_above') return gs > parseFloat(value);
      return numericMatch(gs, value, op);
    }

    case 'speed_below': {
      const gs = aircraft.gs;
      if (gs === null || gs === undefined) return false;
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
      if (dist == null || typeof dist !== 'number' || isNaN(dist)) return false;
      const threshold = parseFloat(value);
      if (isNaN(threshold)) return false;
      if (condType === 'distance_within') return dist <= threshold;
      if (op === 'lt' || op === 'lte') return dist <= threshold;
      if (op === 'gt' || op === 'gte') return dist >= threshold;
      return dist <= threshold;
    }

    case 'category':
      return stringMatch(aircraft.category || '', value, op);

    case 'military': {
      const isMilitary = isAircraftMilitary(aircraft);
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isMilitary === expected;
    }

    case 'emergency': {
      const isEmergency = isAircraftEmergency(aircraft);
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isEmergency === expected;
    }

    case 'aircraft_type':
    case 'type':
      return stringMatch(aircraft.t || aircraft.type || '', value, op);

    case 'registration':
      return stringMatch(aircraft.r || aircraft.registration || '', value, op);

    case 'operator':
      return stringMatch(aircraft.ownOp || aircraft.operator || '', value, op);

    case 'law_enforcement': {
      const leInfo = identifyLawEnforcement(aircraft);
      const isLE = leInfo.isLawEnforcement;
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isLE === expected;
    }

    case 'helicopter': {
      const category = aircraft.category || '';
      const typeCode = aircraft.t || aircraft.type || '';
      const isHeli = checkIsHelicopter(category, typeCode);
      const expected = value === '' || ['TRUE', 'YES', '1'].includes(value);
      return isHeli === expected;
    }

    case 'distance_from_mobile': {
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
 */
export function evaluateConditionGroup(group, aircraft, distanceNm = null) {
  if (!group || !aircraft) return false;
  const conditions = group.conditions || [];
  const logic = (group.logic || 'AND').toUpperCase();
  if (conditions.length === 0) return false;
  if (logic === 'OR') return conditions.some(c => evaluateCondition(c, aircraft, distanceNm));
  return conditions.every(c => evaluateCondition(c, aircraft, distanceNm));
}

/**
 * Evaluate if an aircraft matches a rule.
 */
export function evaluateRule(rule, aircraft, distanceNm = null) {
  if (!rule || !aircraft) return false;
  const conditions = rule.conditions;

  // Complex conditions with groups
  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    const groups = conditions.groups || [];
    const logic = (conditions.logic || 'AND').toUpperCase();
    if (groups.length > 0) {
      if (logic === 'OR') return groups.some(g => evaluateConditionGroup(g, aircraft, distanceNm));
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
 */
export function findMatchingAircraft(rule, aircraftList, feederLocation = null) {
  if (!rule || !Array.isArray(aircraftList)) return [];

  const matches = [];
  for (const aircraft of aircraftList) {
    let distanceNm = aircraft.distance_nm;
    if (!distanceNm && feederLocation && aircraft.lat && aircraft.lon) {
      distanceNm = calculateDistanceNm(feederLocation.lat, feederLocation.lon, aircraft.lat, aircraft.lon);
    }
    if (evaluateRule(rule, aircraft, distanceNm)) {
      const matchReasons = getMatchReasons(rule, aircraft, distanceNm);
      matches.push({ ...aircraft, matchReasons, calculatedDistance: distanceNm });
    }
  }
  return matches;
}

/**
 * Get human-readable reasons for why an aircraft matched a rule.
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
      case 'callsign': reasons.push(`Callsign ${operator} "${value}" (${aircraft.flight || 'N/A'})`); break;
      case 'hex':
      case 'icao': reasons.push(`ICAO ${operator} "${value}" (${aircraft.hex || 'N/A'})`); break;
      case 'squawk': reasons.push(`Squawk ${operator} "${value}" (${aircraft.squawk || 'N/A'})`); break;
      case 'altitude_above': reasons.push(`Altitude above ${value}ft (${aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 'N/A'}ft)`); break;
      case 'altitude_below': reasons.push(`Altitude below ${value}ft (${aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 'N/A'}ft)`); break;
      case 'speed_above': reasons.push(`Speed above ${value}kts (${aircraft.gs || 'N/A'}kts)`); break;
      case 'speed_below': reasons.push(`Speed below ${value}kts (${aircraft.gs || 'N/A'}kts)`); break;
      case 'distance_within': reasons.push(`Within ${value}nm (${distanceNm?.toFixed(1) || aircraft.distance_nm?.toFixed(1) || 'N/A'}nm)`); break;
      case 'military': reasons.push('Military aircraft'); break;
      case 'emergency': reasons.push(`Emergency (squawk: ${aircraft.squawk || 'N/A'})`); break;
      case 'type':
      case 'aircraft_type': reasons.push(`Aircraft type ${operator} "${value}" (${aircraft.t || aircraft.type || 'N/A'})`); break;
      case 'law_enforcement': reasons.push('Law enforcement aircraft'); break;
      case 'helicopter': reasons.push('Helicopter'); break;
      case 'distance_from_mobile': reasons.push(`Within ${value}nm from mobile (${aircraft.mobileDistanceNm?.toFixed(1) || distanceNm?.toFixed(1) || 'N/A'}nm)`); break;
      default: reasons.push(`${type} ${operator} "${value}"`);
    }
  };

  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    for (const group of (conditions.groups || [])) {
      for (const c of (group.conditions || [])) checkCondition(c);
    }
  }
  if (Array.isArray(conditions)) {
    for (const c of conditions) checkCondition(c);
  }
  if (rule.rule_type || rule.type) {
    checkCondition({ type: rule.rule_type || rule.type, operator: rule.operator, value: rule.value });
  }

  return reasons.length > 0 ? reasons : ['Matches rule conditions'];
}

/**
 * Get relevant aircraft values based on rule conditions for display.
 */
export function getRelevantValues(rule, aircraft) {
  const values = { callsign: aircraft.flight || aircraft.callsign || null, hex: aircraft.hex };
  const conditions = rule.conditions;

  const extractTypes = (conditionsList) => {
    if (!Array.isArray(conditionsList)) return;
    for (const c of conditionsList) {
      const type = (c.type || '').toLowerCase();
      switch (type) {
        case 'altitude_above':
        case 'altitude_below':
        case 'altitude': values.altitude = aircraft.alt_baro || aircraft.alt_geom || aircraft.alt; break;
        case 'speed_above':
        case 'speed_below':
        case 'speed': values.speed = aircraft.gs; break;
        case 'distance_within':
        case 'proximity': values.distance = aircraft.distance_nm; break;
        case 'squawk': values.squawk = aircraft.squawk; break;
        case 'type':
        case 'aircraft_type': values.type = aircraft.t || aircraft.type; break;
        case 'military': values.military = isAircraftMilitary(aircraft); break;
        case 'emergency': values.emergency = isAircraftEmergency(aircraft); break;
        case 'law_enforcement':
          const leInfo = identifyLawEnforcement(aircraft);
          values.lawEnforcement = leInfo.isLawEnforcement;
          values.leCategory = leInfo.category;
          break;
        case 'helicopter':
          values.helicopter = checkIsHelicopter(aircraft.category || '', aircraft.t || aircraft.type || '');
          break;
        case 'distance_from_mobile': values.mobileDistance = aircraft.mobileDistanceNm; break;
      }
    }
  };

  if (conditions && typeof conditions === 'object' && !Array.isArray(conditions)) {
    for (const group of (conditions.groups || [])) extractTypes(group.conditions || []);
  }
  if (Array.isArray(conditions)) extractTypes(conditions);

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
