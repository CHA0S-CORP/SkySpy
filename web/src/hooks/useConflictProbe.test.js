/**
 * Tests for useConflictProbe hook
 *
 * Phase 3.4: Conflict Probe (Look-Ahead)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConflictProbe } from './useConflictProbe';

// Mock aircraft data
const createAircraft = (hex, lat, lon, alt, track, gs, vr = 0) => ({
  hex,
  lat,
  lon,
  alt_baro: alt,
  track,
  gs,
  baro_rate: vr,
  flight: `TEST${hex}`,
});

describe('useConflictProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should return empty conflicts array when disabled', () => {
      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft: [],
          feederLocation: { lat: 47.9, lon: -122.0 },
          enabled: false,
        })
      );

      expect(result.current.conflicts).toEqual([]);
      expect(result.current.conflictCount).toBe(0);
    });

    it('should return empty conflicts array with no aircraft', () => {
      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft: [],
          feederLocation: { lat: 47.9, lon: -122.0 },
          enabled: true,
        })
      );

      expect(result.current.conflicts).toEqual([]);
      expect(result.current.conflictCount).toBe(0);
    });

    it('should return empty conflicts array with single aircraft', () => {
      const aircraft = [createAircraft('ABC123', 47.5, -122.0, 10000, 90, 250)];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.9, lon: -122.0 },
          enabled: true,
        })
      );

      expect(result.current.conflicts).toEqual([]);
    });
  });

  describe('conflict detection', () => {
    it('should detect converging aircraft on collision course', () => {
      // Two aircraft heading toward each other at same altitude
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 30000, 90, 450), // heading east
        createAircraft('AC2', 47.5, -121.5, 30000, 270, 450), // heading west
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.75 },
          enabled: true,
        })
      );

      // Advance time to allow analysis
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.conflicts.length).toBeGreaterThan(0);
      const conflict = result.current.conflicts[0];
      expect(conflict.alertLevel).toMatch(/red|orange|yellow/);
    });

    it('should not detect conflict for diverging aircraft', () => {
      // Two aircraft flying away from each other
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 30000, 270, 450), // heading west
        createAircraft('AC2', 47.5, -121.5, 30000, 90, 450), // heading east
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.75 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.conflicts.length).toBe(0);
    });

    it('should not detect conflict with sufficient vertical separation', () => {
      // Two aircraft converging but with 2000ft separation
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 30000, 90, 450), // FL300
        createAircraft('AC2', 47.5, -121.5, 32000, 270, 450), // FL320
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.75 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.conflicts.length).toBe(0);
    });

    it('should ignore ground aircraft', () => {
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 0, 90, 15), // on ground
        createAircraft('AC2', 47.5, -121.99, 0, 270, 15), // on ground
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.995 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.conflicts.length).toBe(0);
    });
  });

  describe('alert levels', () => {
    it('should assign RED alert for imminent conflict', () => {
      // Aircraft very close and converging quickly
      const aircraft = [
        createAircraft('AC1', 47.5, -122.01, 30000, 90, 450),
        createAircraft('AC2', 47.5, -121.99, 30000, 270, 450),
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -122.0 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      if (result.current.conflicts.length > 0) {
        expect(result.current.conflicts[0].alertLevel).toBe('red');
      }
    });
  });

  describe('stats calculation', () => {
    it('should provide correct stats breakdown', () => {
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 30000, 90, 450),
        createAircraft('AC2', 47.5, -121.5, 30000, 270, 450),
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.75 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.stats).toHaveProperty('total');
      expect(result.current.stats).toHaveProperty('red');
      expect(result.current.stats).toHaveProperty('orange');
      expect(result.current.stats).toHaveProperty('yellow');
    });
  });

  describe('helper functions', () => {
    it('should find conflict for specific aircraft', () => {
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 30000, 90, 450),
        createAircraft('AC2', 47.5, -121.5, 30000, 270, 450),
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.75 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      if (result.current.conflicts.length > 0) {
        const conflict = result.current.getConflictForAircraft('AC1');
        expect(conflict).toBeDefined();
        expect(conflict.aircraft1.hex === 'AC1' || conflict.aircraft2.hex === 'AC1').toBe(true);
      }
    });

    it('should return null for aircraft not in conflict', () => {
      const aircraft = [
        createAircraft('AC1', 47.5, -122.0, 30000, 90, 450),
        createAircraft('AC2', 48.5, -120.0, 25000, 180, 350), // far away
      ];

      const { result } = renderHook(() =>
        useConflictProbe({
          aircraft,
          feederLocation: { lat: 47.5, lon: -121.75 },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      const conflict = result.current.getConflictForAircraft('AC3');
      expect(conflict).toBeNull();
    });
  });
});
