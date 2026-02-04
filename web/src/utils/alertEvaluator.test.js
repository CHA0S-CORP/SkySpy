import { describe, it, expect, vi } from 'vitest';
import {
  evaluateCondition,
  evaluateConditionGroup,
  evaluateRule,
  findMatchingAircraft,
  getMatchReasons,
  getRelevantValues,
  calculateDistanceNm,
} from './alertEvaluator';

// Mock aircraft data for testing
const mockAircraft = {
  hex: 'A12345',
  flight: 'UAL123',
  callsign: 'UAL123',
  squawk: '7700',
  alt_baro: 35000,
  alt_geom: 35100,
  gs: 450,
  baro_rate: -500,
  lat: 40.7128,
  lon: -74.006,
  category: 'A3',
  t: 'A320',
  type: 'A320',
  r: 'N12345',
  registration: 'N12345',
  ownOp: 'United Airlines',
  operator: 'United Airlines',
  military: false,
  dbFlags: 0,
  distance_nm: 5.5,
};

const mockMilitaryAircraft = {
  hex: 'AE1234',
  flight: 'REACH001',
  squawk: '1234',
  alt_baro: 25000,
  gs: 350,
  lat: 38.9,
  lon: -77.0,
  category: 'A5',
  t: 'C17',
  military: true,
  dbFlags: 1,
};

const mockEmergencyAircraft = {
  hex: 'B54321',
  flight: 'DAL456',
  squawk: '7700',
  alt_baro: 10000,
  gs: 200,
  emergency: true,
};

describe('evaluateCondition', () => {
  describe('null/invalid inputs', () => {
    it('should return false for null condition', () => {
      expect(evaluateCondition(null, mockAircraft)).toBe(false);
    });

    it('should return false for null aircraft', () => {
      expect(evaluateCondition({ type: 'callsign', value: 'UAL123' }, null)).toBe(false);
    });

    it('should return false for empty condition', () => {
      expect(evaluateCondition({}, mockAircraft)).toBe(false);
    });

    it('should return false for unknown condition type', () => {
      expect(evaluateCondition({ type: 'unknown', value: 'test' }, mockAircraft)).toBe(false);
    });
  });

  describe('ICAO/hex conditions', () => {
    it('should match hex exactly', () => {
      const condition = { type: 'hex', operator: 'equals', value: 'A12345' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match icao type (alias for hex)', () => {
      const condition = { type: 'icao', operator: 'equals', value: 'A12345' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should be case insensitive', () => {
      const condition = { type: 'hex', operator: 'equals', value: 'a12345' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should not match different hex', () => {
      const condition = { type: 'hex', operator: 'equals', value: 'B99999' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });

    it('should match hex with contains operator', () => {
      const condition = { type: 'hex', operator: 'contains', value: '123' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });
  });

  describe('callsign conditions', () => {
    it('should match callsign exactly', () => {
      const condition = { type: 'callsign', operator: 'equals', value: 'UAL123' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match using flight field', () => {
      const aircraft = { flight: 'DAL456' };
      const condition = { type: 'callsign', operator: 'equals', value: 'DAL456' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should match using callsign field', () => {
      const aircraft = { callsign: 'SWA789' };
      const condition = { type: 'callsign', operator: 'equals', value: 'SWA789' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should match callsign with starts_with operator', () => {
      const condition = { type: 'callsign', operator: 'starts_with', value: 'UAL' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match callsign with contains operator', () => {
      const condition = { type: 'callsign', operator: 'contains', value: '12' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should not match different callsign', () => {
      const condition = { type: 'callsign', operator: 'equals', value: 'DAL456' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });
  });

  describe('squawk conditions', () => {
    it('should match squawk exactly', () => {
      const condition = { type: 'squawk', operator: 'equals', value: '7700' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match emergency squawk 7500', () => {
      const aircraft = { squawk: '7500' };
      const condition = { type: 'squawk', operator: 'equals', value: '7500' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should match squawk with starts_with', () => {
      const condition = { type: 'squawk', operator: 'starts_with', value: '77' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });
  });

  describe('altitude conditions', () => {
    it('should match altitude with greater_than operator', () => {
      const condition = { type: 'altitude', operator: 'greater_than', value: '30000' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match altitude with less_than operator', () => {
      const condition = { type: 'altitude', operator: 'less_than', value: '40000' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match altitude_above condition', () => {
      const condition = { type: 'altitude_above', value: '30000' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should not match altitude_above when below', () => {
      const condition = { type: 'altitude_above', value: '40000' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });

    it('should match altitude_below condition', () => {
      const condition = { type: 'altitude_below', value: '40000' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should not match altitude_below when above', () => {
      const condition = { type: 'altitude_below', value: '30000' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });

    it('should use alt_geom if alt_baro is not available', () => {
      const aircraft = { alt_geom: 20000 };
      const condition = { type: 'altitude_above', value: '15000' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should use alt if alt_baro and alt_geom are not available', () => {
      const aircraft = { alt: 18000 };
      const condition = { type: 'altitude_above', value: '15000' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should return false if no altitude data', () => {
      const aircraft = { hex: 'ABC123' };
      const condition = { type: 'altitude_above', value: '10000' };
      expect(evaluateCondition(condition, aircraft)).toBe(false);
    });
  });

  describe('speed conditions', () => {
    it('should match speed with greater_than operator', () => {
      const condition = { type: 'speed', operator: 'greater_than', value: '400' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match speed_above condition', () => {
      const condition = { type: 'speed_above', value: '400' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match speed_below condition', () => {
      const condition = { type: 'speed_below', value: '500' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should return false if no speed data', () => {
      const aircraft = { hex: 'ABC123' };
      const condition = { type: 'speed_above', value: '100' };
      expect(evaluateCondition(condition, aircraft)).toBe(false);
    });
  });

  describe('vertical_rate conditions', () => {
    it('should match vertical rate with less_than (descending)', () => {
      const condition = { type: 'vertical_rate', operator: 'less_than', value: '0' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match vertical rate with greater_than (climbing)', () => {
      const aircraft = { baro_rate: 1000 };
      const condition = { type: 'vertical_rate', operator: 'greater_than', value: '500' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should use geom_rate if baro_rate not available', () => {
      const aircraft = { geom_rate: 2000 };
      const condition = { type: 'vertical_rate', operator: 'greater_than', value: '1000' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });
  });

  describe('distance conditions', () => {
    it('should match distance_within using provided distanceNm', () => {
      const condition = { type: 'distance_within', value: '10' };
      expect(evaluateCondition(condition, mockAircraft, 5)).toBe(true);
    });

    it('should not match distance_within when outside', () => {
      const condition = { type: 'distance_within', value: '3' };
      expect(evaluateCondition(condition, mockAircraft, 5)).toBe(false);
    });

    it('should use aircraft.distance_nm if distanceNm not provided', () => {
      const condition = { type: 'distance_within', value: '10' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should handle proximity condition type', () => {
      const condition = { type: 'proximity', operator: 'lt', value: '10' };
      expect(evaluateCondition(condition, mockAircraft, 5)).toBe(true);
    });

    it('should return false for invalid distance value', () => {
      const condition = { type: 'distance_within', value: 'invalid' };
      expect(evaluateCondition(condition, mockAircraft, 5)).toBe(false);
    });

    it('should return false for null/NaN distance', () => {
      const condition = { type: 'distance_within', value: '10' };
      const aircraft = { hex: 'ABC123' };
      expect(evaluateCondition(condition, aircraft, null)).toBe(false);
    });
  });

  describe('category conditions', () => {
    it('should match category', () => {
      const condition = { type: 'category', operator: 'equals', value: 'A3' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should not match different category', () => {
      const condition = { type: 'category', operator: 'equals', value: 'A7' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });
  });

  describe('military conditions', () => {
    it('should match military aircraft', () => {
      const condition = { type: 'military', value: 'true' };
      expect(evaluateCondition(condition, mockMilitaryAircraft)).toBe(true);
    });

    it('should not match non-military aircraft', () => {
      const condition = { type: 'military', value: 'true' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });

    it('should handle empty value as true', () => {
      const condition = { type: 'military', value: '' };
      expect(evaluateCondition(condition, mockMilitaryAircraft)).toBe(true);
    });

    it('should detect military via dbFlags', () => {
      const aircraft = { dbFlags: 1 };
      const condition = { type: 'military', value: 'yes' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });
  });

  describe('emergency conditions', () => {
    it('should match emergency squawk 7700', () => {
      const condition = { type: 'emergency', value: 'true' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match emergency squawk 7500', () => {
      const aircraft = { squawk: '7500' };
      const condition = { type: 'emergency', value: 'true' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should match emergency squawk 7600', () => {
      const aircraft = { squawk: '7600' };
      const condition = { type: 'emergency', value: 'true' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should match emergency flag', () => {
      const condition = { type: 'emergency', value: 'true' };
      expect(evaluateCondition(condition, mockEmergencyAircraft)).toBe(true);
    });

    it('should not match non-emergency aircraft', () => {
      const aircraft = { squawk: '1234' };
      const condition = { type: 'emergency', value: 'true' };
      expect(evaluateCondition(condition, aircraft)).toBe(false);
    });
  });

  describe('aircraft_type conditions', () => {
    it('should match aircraft type', () => {
      const condition = { type: 'aircraft_type', operator: 'equals', value: 'A320' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match using type alias', () => {
      const condition = { type: 'type', operator: 'equals', value: 'A320' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match type with contains', () => {
      const condition = { type: 'aircraft_type', operator: 'contains', value: 'A32' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });
  });

  describe('registration conditions', () => {
    it('should match registration', () => {
      const condition = { type: 'registration', operator: 'equals', value: 'N12345' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match using r field', () => {
      const aircraft = { r: 'G-ABCD' };
      const condition = { type: 'registration', operator: 'equals', value: 'G-ABCD' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });
  });

  describe('operator conditions', () => {
    it('should match operator', () => {
      const condition = { type: 'operator', operator: 'equals', value: 'UNITED AIRLINES' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });

    it('should match operator with contains', () => {
      const condition = { type: 'operator', operator: 'contains', value: 'UNITED' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(true);
    });
  });

  describe('law_enforcement conditions', () => {
    it('should match law enforcement aircraft', () => {
      const aircraft = { flight: 'LAPD1' };
      const condition = { type: 'law_enforcement', value: 'true' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should not match non-law enforcement', () => {
      const condition = { type: 'law_enforcement', value: 'true' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });
  });

  describe('helicopter conditions', () => {
    it('should match helicopter by category', () => {
      const aircraft = { category: 'A7' };
      const condition = { type: 'helicopter', value: 'true' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should match helicopter by type', () => {
      const aircraft = { t: 'EC35' };
      const condition = { type: 'helicopter', value: 'true' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should not match fixed wing', () => {
      const condition = { type: 'helicopter', value: 'true' };
      expect(evaluateCondition(condition, mockAircraft)).toBe(false);
    });
  });

  describe('distance_from_mobile conditions', () => {
    it('should match using mobileDistanceNm', () => {
      const aircraft = { mobileDistanceNm: 3 };
      const condition = { type: 'distance_from_mobile', value: '5' };
      expect(evaluateCondition(condition, aircraft)).toBe(true);
    });

    it('should fallback to distanceNm parameter', () => {
      const aircraft = { hex: 'ABC123' };
      const condition = { type: 'distance_from_mobile', value: '10' };
      expect(evaluateCondition(condition, aircraft, 5)).toBe(true);
    });

    it('should return false for null distance', () => {
      const aircraft = { hex: 'ABC123' };
      const condition = { type: 'distance_from_mobile', value: '10' };
      expect(evaluateCondition(condition, aircraft, null)).toBe(false);
    });
  });
});

describe('evaluateConditionGroup', () => {
  it('should return false for null group', () => {
    expect(evaluateConditionGroup(null, mockAircraft)).toBe(false);
  });

  it('should return false for null aircraft', () => {
    const group = { conditions: [{ type: 'callsign', value: 'UAL123' }], logic: 'AND' };
    expect(evaluateConditionGroup(group, null)).toBe(false);
  });

  it('should return false for empty conditions', () => {
    const group = { conditions: [], logic: 'AND' };
    expect(evaluateConditionGroup(group, mockAircraft)).toBe(false);
  });

  describe('AND logic', () => {
    it('should return true when all conditions match', () => {
      const group = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'UAL123' },
          { type: 'altitude_above', value: '30000' },
        ],
        logic: 'AND',
      };
      expect(evaluateConditionGroup(group, mockAircraft)).toBe(true);
    });

    it('should return false when any condition fails', () => {
      const group = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'UAL123' },
          { type: 'altitude_above', value: '40000' },
        ],
        logic: 'AND',
      };
      expect(evaluateConditionGroup(group, mockAircraft)).toBe(false);
    });

    it('should default to AND logic', () => {
      const group = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'UAL123' },
          { type: 'altitude_above', value: '30000' },
        ],
      };
      expect(evaluateConditionGroup(group, mockAircraft)).toBe(true);
    });
  });

  describe('OR logic', () => {
    it('should return true when any condition matches', () => {
      const group = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'DAL456' },
          { type: 'altitude_above', value: '30000' },
        ],
        logic: 'OR',
      };
      expect(evaluateConditionGroup(group, mockAircraft)).toBe(true);
    });

    it('should return false when no conditions match', () => {
      const group = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'DAL456' },
          { type: 'altitude_above', value: '40000' },
        ],
        logic: 'OR',
      };
      expect(evaluateConditionGroup(group, mockAircraft)).toBe(false);
    });

    it('should handle lowercase logic', () => {
      const group = {
        conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
        logic: 'or',
      };
      expect(evaluateConditionGroup(group, mockAircraft)).toBe(true);
    });
  });
});

describe('evaluateRule', () => {
  it('should return false for null rule', () => {
    expect(evaluateRule(null, mockAircraft)).toBe(false);
  });

  it('should return false for null aircraft', () => {
    expect(evaluateRule({ conditions: [] }, null)).toBe(false);
  });

  describe('complex conditions with groups', () => {
    it('should evaluate groups with AND logic', () => {
      const rule = {
        conditions: {
          groups: [
            {
              conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
              logic: 'AND',
            },
            {
              conditions: [{ type: 'altitude_above', value: '30000' }],
              logic: 'AND',
            },
          ],
          logic: 'AND',
        },
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(true);
    });

    it('should evaluate groups with OR logic', () => {
      const rule = {
        conditions: {
          groups: [
            {
              conditions: [{ type: 'callsign', operator: 'equals', value: 'DAL456' }],
              logic: 'AND',
            },
            {
              conditions: [{ type: 'altitude_above', value: '30000' }],
              logic: 'AND',
            },
          ],
          logic: 'OR',
        },
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(true);
    });

    it('should fail when all groups fail with AND logic', () => {
      const rule = {
        conditions: {
          groups: [
            {
              conditions: [{ type: 'callsign', operator: 'equals', value: 'DAL456' }],
              logic: 'AND',
            },
          ],
          logic: 'AND',
        },
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(false);
    });
  });

  describe('simple flat array conditions', () => {
    it('should evaluate flat array with AND logic', () => {
      const rule = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'UAL123' },
          { type: 'altitude_above', value: '30000' },
        ],
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(true);
    });

    it('should fail when any condition fails', () => {
      const rule = {
        conditions: [
          { type: 'callsign', operator: 'equals', value: 'UAL123' },
          { type: 'altitude_above', value: '40000' },
        ],
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(false);
    });
  });

  describe('legacy single condition format', () => {
    it('should evaluate legacy rule_type format', () => {
      const rule = {
        rule_type: 'callsign',
        operator: 'equals',
        value: 'UAL123',
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(true);
    });

    it('should evaluate legacy type format', () => {
      const rule = {
        type: 'altitude_above',
        value: '30000',
      };
      expect(evaluateRule(rule, mockAircraft)).toBe(true);
    });
  });

  it('should return false for rule with no conditions', () => {
    const rule = { name: 'Empty rule' };
    expect(evaluateRule(rule, mockAircraft)).toBe(false);
  });
});

describe('findMatchingAircraft', () => {
  const aircraftList = [
    { hex: 'A11111', flight: 'UAL100', alt_baro: 35000, lat: 40.7, lon: -74.0, distance_nm: 5 },
    { hex: 'A22222', flight: 'DAL200', alt_baro: 25000, lat: 40.8, lon: -74.1, distance_nm: 10 },
    { hex: 'A33333', flight: 'UAL300', alt_baro: 15000, lat: 40.6, lon: -73.9, distance_nm: 3 },
  ];

  it('should return empty array for null rule', () => {
    expect(findMatchingAircraft(null, aircraftList)).toEqual([]);
  });

  it('should return empty array for non-array aircraftList', () => {
    expect(findMatchingAircraft({}, 'not an array')).toEqual([]);
  });

  it('should find matching aircraft', () => {
    const rule = {
      conditions: [{ type: 'callsign', operator: 'starts_with', value: 'UAL' }],
    };
    const matches = findMatchingAircraft(rule, aircraftList);
    expect(matches).toHaveLength(2);
    expect(matches.map((a) => a.hex)).toEqual(['A11111', 'A33333']);
  });

  it('should include matchReasons in results', () => {
    const rule = {
      conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL100' }],
    };
    const matches = findMatchingAircraft(rule, aircraftList);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchReasons).toBeDefined();
    expect(matches[0].matchReasons.length).toBeGreaterThan(0);
  });

  it('should include calculatedDistance in results', () => {
    const rule = {
      conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL100' }],
    };
    const matches = findMatchingAircraft(rule, aircraftList);
    expect(matches[0].calculatedDistance).toBeDefined();
  });

  it('should calculate distance when not provided', () => {
    const aircraftWithoutDistance = [{ hex: 'A44444', flight: 'TEST', lat: 40.7, lon: -74.0 }];
    const feederLocation = { lat: 40.7128, lon: -74.006 };
    const rule = {
      conditions: [{ type: 'callsign', operator: 'equals', value: 'TEST' }],
    };
    const matches = findMatchingAircraft(rule, aircraftWithoutDistance, feederLocation);
    expect(matches).toHaveLength(1);
    expect(matches[0].calculatedDistance).toBeDefined();
    expect(typeof matches[0].calculatedDistance).toBe('number');
  });
});

describe('getMatchReasons', () => {
  it('should return default reason for no matches', () => {
    const rule = { conditions: [] };
    const reasons = getMatchReasons(rule, mockAircraft);
    expect(reasons).toEqual(['Matches rule conditions']);
  });

  it('should return callsign match reason', () => {
    const rule = {
      conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
    };
    const reasons = getMatchReasons(rule, mockAircraft);
    expect(reasons[0]).toContain('Callsign');
    expect(reasons[0]).toContain('UAL123');
  });

  it('should return altitude match reason', () => {
    const rule = {
      conditions: [{ type: 'altitude_above', value: '30000' }],
    };
    const reasons = getMatchReasons(rule, mockAircraft);
    expect(reasons[0]).toContain('Altitude above');
    expect(reasons[0]).toContain('35000');
  });

  it('should return military match reason', () => {
    const rule = {
      conditions: [{ type: 'military', value: 'true' }],
    };
    const reasons = getMatchReasons(rule, mockMilitaryAircraft);
    expect(reasons[0]).toContain('Military');
  });

  it('should return emergency match reason', () => {
    const rule = {
      conditions: [{ type: 'emergency', value: 'true' }],
    };
    const reasons = getMatchReasons(rule, mockEmergencyAircraft);
    expect(reasons[0]).toContain('Emergency');
  });

  it('should handle grouped conditions', () => {
    const rule = {
      conditions: {
        groups: [
          {
            conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
          },
        ],
      },
    };
    const reasons = getMatchReasons(rule, mockAircraft);
    expect(reasons[0]).toContain('Callsign');
  });

  it('should handle legacy format', () => {
    const rule = {
      rule_type: 'callsign',
      operator: 'equals',
      value: 'UAL123',
    };
    const reasons = getMatchReasons(rule, mockAircraft);
    expect(reasons[0]).toContain('Callsign');
  });
});

describe('getRelevantValues', () => {
  it('should always include callsign and hex', () => {
    const rule = { conditions: [] };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.callsign).toBe('UAL123');
    expect(values.hex).toBe('A12345');
  });

  it('should extract altitude for altitude conditions', () => {
    const rule = {
      conditions: [{ type: 'altitude_above', value: '30000' }],
    };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.altitude).toBe(35000);
  });

  it('should extract speed for speed conditions', () => {
    const rule = {
      conditions: [{ type: 'speed_above', value: '400' }],
    };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.speed).toBe(450);
  });

  it('should extract distance for distance conditions', () => {
    const rule = {
      conditions: [{ type: 'distance_within', value: '10' }],
    };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.distance).toBe(5.5);
  });

  it('should extract squawk for squawk conditions', () => {
    const rule = {
      conditions: [{ type: 'squawk', operator: 'equals', value: '7700' }],
    };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.squawk).toBe('7700');
  });

  it('should extract type for aircraft_type conditions', () => {
    const rule = {
      conditions: [{ type: 'aircraft_type', operator: 'equals', value: 'A320' }],
    };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.type).toBe('A320');
  });

  it('should extract military flag for military conditions', () => {
    const rule = {
      conditions: [{ type: 'military', value: 'true' }],
    };
    const values = getRelevantValues(rule, mockMilitaryAircraft);
    expect(values.military).toBe(true);
  });

  it('should handle grouped conditions', () => {
    const rule = {
      conditions: {
        groups: [
          {
            conditions: [{ type: 'altitude_above', value: '30000' }],
          },
        ],
      },
    };
    const values = getRelevantValues(rule, mockAircraft);
    expect(values.altitude).toBe(35000);
  });
});

describe('calculateDistanceNm', () => {
  it('should calculate distance between two points', () => {
    // New York to Los Angeles (approximately 2143 nm)
    const distance = calculateDistanceNm(40.7128, -74.006, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(2100);
    expect(distance).toBeLessThan(2200);
  });

  it('should return 0 for same point', () => {
    const distance = calculateDistanceNm(40.7128, -74.006, 40.7128, -74.006);
    expect(distance).toBeCloseTo(0, 5);
  });

  it('should handle crossing the equator', () => {
    const distance = calculateDistanceNm(10, 0, -10, 0);
    expect(distance).toBeGreaterThan(0);
  });

  it('should handle crossing the prime meridian', () => {
    const distance = calculateDistanceNm(0, 10, 0, -10);
    expect(distance).toBeGreaterThan(0);
  });
});
