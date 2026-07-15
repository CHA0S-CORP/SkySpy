import { describe, it, expect } from 'vitest';
import {
  calculateETAToPoint,
  calculateETAToNearbyAirports,
  calculatePredictedPosition,
} from './etaCalculations';

describe('etaCalculations', () => {
  describe('calculateETAToPoint', () => {
    it('calculates ETA for coordinates of exactly 0 (equator / prime meridian)', () => {
      // Aircraft on the prime meridian heading north toward a target on the equator
      const aircraft = { lat: -1, lon: 0, gs: 400, track: 0 };
      const target = { lat: 0, lon: 0 };

      const result = calculateETAToPoint(aircraft, target);

      expect(result.distanceNm).not.toBeNull();
      expect(result.distanceNm).toBeGreaterThan(0);
      expect(result.isApproaching).toBe(true);
      expect(result.etaSeconds).toBeGreaterThan(0);
    });

    it('returns nulls for missing coordinates', () => {
      const result = calculateETAToPoint({ lat: null, lon: 10, gs: 400 }, { lat: 0, lon: 0 });
      expect(result.distanceNm).toBeNull();
      expect(result.etaSeconds).toBeNull();
    });

    it('returns nulls for non-finite coordinates', () => {
      const result = calculateETAToPoint({ lat: NaN, lon: 10, gs: 400 }, { lat: 0, lon: 0 });
      expect(result.distanceNm).toBeNull();
    });
  });

  describe('calculateETAToNearbyAirports', () => {
    it('includes airports at lat/lon 0 and aircraft at lon 0', () => {
      const aircraft = { lat: 1, lon: 0, gs: 400, track: 180 };
      const airports = [{ lat: 0, lon: 0, icao: 'EQTR' }];

      const results = calculateETAToNearbyAirports(aircraft, airports, { maxDistance: 100 });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('EQTR');
      expect(results[0].distanceNm).toBeGreaterThan(0);
    });

    it('skips airports with missing coordinates', () => {
      const aircraft = { lat: 1, lon: 0, gs: 400, track: 180 };
      const airports = [{ lat: null, lon: null, icao: 'BAD' }];
      expect(calculateETAToNearbyAirports(aircraft, airports)).toHaveLength(0);
    });
  });

  describe('calculatePredictedPosition', () => {
    it('projects position for an aircraft at exactly 0,0', () => {
      const aircraft = { lat: 0, lon: 0, gs: 400, track: 90 };

      const result = calculatePredictedPosition(aircraft, 600);

      // Heading due east from 0,0 — longitude must advance
      expect(result.lon).toBeGreaterThan(0);
      expect(result.lat).toBeCloseTo(0, 3);
    });

    it('returns unmoved position for seconds <= 0', () => {
      const aircraft = { lat: 10, lon: 20, gs: 400, track: 90 };
      expect(calculatePredictedPosition(aircraft, 0)).toEqual({ lat: 10, lon: 20 });
      expect(calculatePredictedPosition(aircraft, -5)).toEqual({ lat: 10, lon: 20 });
    });
  });
});
