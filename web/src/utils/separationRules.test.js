/**
 * Tests for Separation Rules Utility
 * Phase 8.5 Implementation
 */

import { describe, it, expect } from 'vitest';
import {
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
  FL290_FEET,
  TERMINAL_RADAR_RANGE_NM,
  SEPARATION_STATUS,
} from './separationRules';

describe('separationRules', () => {
  describe('calculateDistanceNm', () => {
    it('should return 0 for same position', () => {
      const dist = calculateDistanceNm(47.0, -122.0, 47.0, -122.0);
      expect(dist).toBe(0);
    });

    it('should calculate distance correctly for nearby points', () => {
      // 1 degree latitude = 60 nm
      const dist = calculateDistanceNm(47.0, -122.0, 48.0, -122.0);
      expect(dist).toBeCloseTo(60, 0);
    });

    it('should handle negative latitudes', () => {
      const dist = calculateDistanceNm(-33.0, 151.0, -34.0, 151.0);
      expect(dist).toBeCloseTo(60, 0);
    });
  });

  describe('calculateVerticalSeparation', () => {
    it('should calculate absolute difference', () => {
      expect(calculateVerticalSeparation(10000, 8000)).toBe(2000);
      expect(calculateVerticalSeparation(8000, 10000)).toBe(2000);
    });

    it('should return null for null inputs', () => {
      expect(calculateVerticalSeparation(null, 10000)).toBeNull();
      expect(calculateVerticalSeparation(10000, null)).toBeNull();
    });
  });

  describe('getRequiredLateralSeparation', () => {
    it('should return 3nm for terminal radar area', () => {
      const result = getRequiredLateralSeparation(20);
      expect(result.required).toBe(3);
      expect(result.type).toBe('terminal');
    });

    it('should return 3nm at boundary', () => {
      const result = getRequiredLateralSeparation(TERMINAL_RADAR_RANGE_NM);
      expect(result.required).toBe(3);
    });

    it('should return 5nm beyond terminal area', () => {
      const result = getRequiredLateralSeparation(50);
      expect(result.required).toBe(5);
      expect(result.type).toBe('enroute');
    });
  });

  describe('getRequiredVerticalSeparation', () => {
    it('should return 1000ft below FL290', () => {
      const result = getRequiredVerticalSeparation(25000, 26000);
      expect(result.required).toBe(1000);
      expect(result.type).toBe('standard');
    });

    it('should return 2000ft at/above FL290 (RVSM)', () => {
      const result = getRequiredVerticalSeparation(30000, 32000);
      expect(result.required).toBe(2000);
      expect(result.type).toBe('rvsm');
    });

    it('should use RVSM if either aircraft is at/above FL290', () => {
      const result = getRequiredVerticalSeparation(25000, FL290_FEET);
      expect(result.required).toBe(2000);
    });
  });

  describe('calculateSeparation', () => {
    const ac1 = { lat: 47.0, lon: -122.0, alt_baro: 10000 };
    const ac2 = { lat: 47.5, lon: -122.0, alt_baro: 12000 };

    it('should calculate both lateral and vertical separation', () => {
      const result = calculateSeparation(ac1, ac2);
      expect(result.lateral).toBeCloseTo(30, 0);
      expect(result.vertical).toBe(2000);
    });

    it('should handle altitude field', () => {
      const ac1Alt = { lat: 47.0, lon: -122.0, altitude: 10000 };
      const ac2Alt = { lat: 47.0, lon: -122.0, altitude: 11000 };
      const result = calculateSeparation(ac1Alt, ac2Alt);
      expect(result.vertical).toBe(1000);
    });

    it('should return null for invalid inputs', () => {
      expect(calculateSeparation(null, ac2)).toBeNull();
      expect(calculateSeparation(ac1, null)).toBeNull();
      expect(calculateSeparation({ lat: null }, ac2)).toBeNull();
    });
  });

  describe('getSeparationStatus', () => {
    it('should return adequate for sufficient separation', () => {
      const actual = { lateral: 5, vertical: 2000 };
      const required = {
        lateral: { required: 3 },
        vertical: { required: 1000 },
      };
      const result = getSeparationStatus(actual, required);
      expect(result.overall).toBe(SEPARATION_STATUS.ADEQUATE);
    });

    it('should return violation for insufficient separation', () => {
      const actual = { lateral: 2, vertical: 500 };
      const required = {
        lateral: { required: 3 },
        vertical: { required: 1000 },
      };
      const result = getSeparationStatus(actual, required);
      expect(result.lateral).toBe(SEPARATION_STATUS.VIOLATION);
      expect(result.vertical).toBe(SEPARATION_STATUS.VIOLATION);
      expect(result.overall).toBe(SEPARATION_STATUS.VIOLATION);
    });

    it('should return marginal for borderline separation', () => {
      const actual = { lateral: 3.5, vertical: 1100 };
      const required = {
        lateral: { required: 3 },
        vertical: { required: 1000 },
      };
      const result = getSeparationStatus(actual, required);
      expect(result.lateral).toBe(SEPARATION_STATUS.MARGINAL);
      expect(result.vertical).toBe(SEPARATION_STATUS.MARGINAL);
      expect(result.overall).toBe(SEPARATION_STATUS.MARGINAL);
    });
  });

  describe('getSeparationColor', () => {
    it('should return green for adequate', () => {
      const color = getSeparationColor(SEPARATION_STATUS.ADEQUATE);
      expect(color.name).toBe('green');
    });

    it('should return yellow for marginal', () => {
      const color = getSeparationColor(SEPARATION_STATUS.MARGINAL);
      expect(color.name).toBe('yellow');
    });

    it('should return red for violation', () => {
      const color = getSeparationColor(SEPARATION_STATUS.VIOLATION);
      expect(color.name).toBe('red');
    });
  });

  describe('checkSeparation', () => {
    const ac1 = { hex: 'abc123', flight: 'UAL123', lat: 47.0, lon: -122.0, alt_baro: 10000 };
    const ac2 = { hex: 'def456', flight: 'DAL456', lat: 47.1, lon: -122.0, alt_baro: 11000 };

    it('should return complete separation analysis', () => {
      const result = checkSeparation(ac1, ac2, { radarLat: 47.0, radarLon: -122.0 });

      expect(result).toBeDefined();
      expect(result.aircraft1.hex).toBe('abc123');
      expect(result.aircraft2.hex).toBe('def456');
      expect(result.actual).toBeDefined();
      expect(result.required).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.color).toBeDefined();
    });

    it('should return null for invalid inputs', () => {
      expect(checkSeparation(null, ac2)).toBeNull();
      expect(checkSeparation(ac1, null)).toBeNull();
    });
  });

  describe('formatSeparationDisplay', () => {
    it('should format separation data for display', () => {
      const separationData = {
        actual: { lateralFormatted: '5.2 nm', verticalFormatted: '1,500 ft' },
        required: {
          lateral: { required: 3, description: 'Terminal (within 40nm)' },
          vertical: { required: 1000, description: 'Standard (below FL290)' },
        },
        status: { lateral: 'adequate', vertical: 'adequate', overall: 'adequate' },
      };

      const result = formatSeparationDisplay(separationData);

      expect(result.lateral.actual).toBe('5.2 nm');
      expect(result.lateral.required).toBe('3 nm min');
      expect(result.vertical.actual).toBe('1,500 ft');
      expect(result.vertical.required).toBe('1,000 ft min');
    });

    it('should return null for null input', () => {
      expect(formatSeparationDisplay(null)).toBeNull();
    });
  });
});
