import { describe, it, expect } from 'vitest';
import { calculateDistanceNm } from './geoUtils';

describe('calculateDistanceNm', () => {
  describe('basic calculations', () => {
    it('should return 0 for same coordinates', () => {
      const distance = calculateDistanceNm(40.7128, -74.006, 40.7128, -74.006);
      expect(distance).toBeCloseTo(0, 5);
    });

    it('should calculate short distance correctly', () => {
      // JFK Airport to Newark Airport (~15 nm)
      const distance = calculateDistanceNm(40.6413, -73.7781, 40.6895, -74.1745);
      expect(distance).toBeGreaterThan(15);
      expect(distance).toBeLessThan(20);
    });

    it('should calculate medium distance correctly', () => {
      // New York to Boston (~170 nm)
      const distance = calculateDistanceNm(40.7128, -74.006, 42.3601, -71.0589);
      expect(distance).toBeGreaterThan(160);
      expect(distance).toBeLessThan(180);
    });

    it('should calculate long distance correctly', () => {
      // New York to Los Angeles (~2130 nm)
      const distance = calculateDistanceNm(40.7128, -74.006, 34.0522, -118.2437);
      expect(distance).toBeGreaterThan(2100);
      expect(distance).toBeLessThan(2200);
    });

    it('should calculate transcontinental distance', () => {
      // New York to London (~3000 nm)
      const distance = calculateDistanceNm(40.7128, -74.006, 51.5074, -0.1278);
      expect(distance).toBeGreaterThan(2900);
      expect(distance).toBeLessThan(3100);
    });
  });

  describe('symmetry', () => {
    it('should return same distance regardless of direction', () => {
      const distance1 = calculateDistanceNm(40.7128, -74.006, 34.0522, -118.2437);
      const distance2 = calculateDistanceNm(34.0522, -118.2437, 40.7128, -74.006);
      expect(distance1).toBeCloseTo(distance2, 5);
    });
  });

  describe('edge cases', () => {
    it('should handle crossing the equator', () => {
      const distance = calculateDistanceNm(10, 0, -10, 0);
      expect(distance).toBeGreaterThan(0);
      // 20 degrees latitude ~ 1200 nm
      expect(distance).toBeGreaterThan(1100);
      expect(distance).toBeLessThan(1300);
    });

    it('should handle crossing the prime meridian', () => {
      const distance = calculateDistanceNm(51.5, 10, 51.5, -10);
      expect(distance).toBeGreaterThan(0);
    });

    it('should handle crossing the date line', () => {
      const distance = calculateDistanceNm(0, 170, 0, -170);
      expect(distance).toBeGreaterThan(0);
      // Should be shorter crossing date line (~20 degrees = ~1200 nm at equator)
      expect(distance).toBeLessThan(1300);
    });

    it('should handle negative latitudes (southern hemisphere)', () => {
      // Sydney to Melbourne (~390 nm)
      const distance = calculateDistanceNm(-33.8688, 151.2093, -37.8136, 144.9631);
      expect(distance).toBeGreaterThan(350);
      expect(distance).toBeLessThan(450);
    });

    it('should handle coordinates at poles', () => {
      // Near North Pole to mid latitude
      const distance = calculateDistanceNm(89, 0, 45, 0);
      expect(distance).toBeGreaterThan(2400);
      expect(distance).toBeLessThan(2700);
    });
  });

  describe('precision', () => {
    it('should have reasonable precision for small distances', () => {
      // Two points 1 nm apart (approximately)
      // 1 nm = 1 minute of latitude = 1/60 degree = 0.01667 degrees
      const lat1 = 40.0;
      const lon1 = -74.0;
      const lat2 = 40.01667;
      const lon2 = -74.0;
      const distance = calculateDistanceNm(lat1, lon1, lat2, lon2);
      expect(distance).toBeCloseTo(1, 1);
    });

    it('should handle very small distances', () => {
      // Points about 0.1 nm apart
      const distance = calculateDistanceNm(40.0, -74.0, 40.00167, -74.0);
      expect(distance).toBeCloseTo(0.1, 1);
    });
  });

  describe('input types', () => {
    it('should handle numeric inputs', () => {
      const distance = calculateDistanceNm(40.7128, -74.006, 34.0522, -118.2437);
      expect(typeof distance).toBe('number');
      expect(isNaN(distance)).toBe(false);
    });

    it('should handle integer coordinates', () => {
      const distance = calculateDistanceNm(40, -74, 34, -118);
      expect(distance).toBeGreaterThan(0);
      expect(isNaN(distance)).toBe(false);
    });
  });

  describe('reference calculations', () => {
    it('should approximately match known great circle distance for KJFK to KLAX', () => {
      // JFK to LAX is approximately 2,145 nm
      const distance = calculateDistanceNm(40.6413, -73.7781, 33.9425, -118.4081);
      expect(distance).toBeGreaterThan(2100);
      expect(distance).toBeLessThan(2200);
    });

    it('should approximately match known distance for KJFK to EGLL', () => {
      // JFK to Heathrow is approximately 3,000 nm
      const distance = calculateDistanceNm(40.6413, -73.7781, 51.4775, -0.4614);
      expect(distance).toBeGreaterThan(2950);
      expect(distance).toBeLessThan(3050);
    });
  });
});
