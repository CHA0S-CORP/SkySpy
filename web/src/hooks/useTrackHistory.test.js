import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackHistory } from './useTrackHistory';

describe('useTrackHistory', () => {
  const feederLat = 37.5;
  const feederLon = -122.5;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with empty track history', () => {
      const { result } = renderHook(() => useTrackHistory([], feederLat, feederLon));

      expect(result.current.trackHistory).toEqual({});
    });
  });

  describe('distance calculation', () => {
    it('should calculate distance from feeder', () => {
      const { result } = renderHook(() => useTrackHistory([], feederLat, feederLon));

      // Same position as feeder
      expect(result.current.getDistanceNm(feederLat, feederLon)).toBe(0);

      // 1 degree north (~60nm at equator, adjusted for latitude)
      const dist = result.current.getDistanceNm(feederLat + 1, feederLon);
      expect(dist).toBeCloseTo(60, 0);
    });

    it('should account for longitude compression at latitude', () => {
      const { result } = renderHook(() => useTrackHistory([], feederLat, feederLon));

      // 1 degree east at our latitude
      const dist = result.current.getDistanceNm(feederLat, feederLon + 1);

      // At 37.5 degrees latitude, cos(37.5) ~= 0.79
      // So 1 degree lon should be about 60 * 0.79 = 47.4 nm
      expect(dist).toBeCloseTo(47.4, 0);
    });
  });

  describe('track history recording', () => {
    it('should record position for aircraft', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 37.6, lon: -122.4, alt_baro: 5000, gs: 250, track: 90 },
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123']).toBeDefined();
      expect(result.current.trackHistory['ABC123']).toHaveLength(1);

      const point = result.current.trackHistory['ABC123'][0];
      expect(point.lat).toBe(37.6);
      expect(point.lon).toBe(-122.4);
      expect(point.alt).toBe(5000);
      expect(point.spd).toBe(250);
      expect(point.trk).toBe(90);
      expect(point.dist).toBeDefined();
    });

    it('should use alt_geom when alt_baro not available', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4, alt_geom: 5500 }];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123'][0].alt).toBe(5500);
    });

    it('should use fallback alt field', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4, alt: 5200 }];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123'][0].alt).toBe(5200);
    });

    it('should use various speed fields', () => {
      // Test gs
      const aircraft1 = [{ hex: 'A1', lat: 37.6, lon: -122.4, gs: 300 }];
      const { result: r1 } = renderHook(() => useTrackHistory(aircraft1, feederLat, feederLon));
      expect(r1.current.trackHistory['A1'][0].spd).toBe(300);

      // Test tas
      const aircraft2 = [{ hex: 'A2', lat: 37.6, lon: -122.4, tas: 280 }];
      const { result: r2 } = renderHook(() => useTrackHistory(aircraft2, feederLat, feederLon));
      expect(r2.current.trackHistory['A2'][0].spd).toBe(280);

      // Test ias
      const aircraft3 = [{ hex: 'A3', lat: 37.6, lon: -122.4, ias: 260 }];
      const { result: r3 } = renderHook(() => useTrackHistory(aircraft3, feederLat, feederLon));
      expect(r3.current.trackHistory['A3'][0].spd).toBe(260);
    });

    it('should use various heading fields', () => {
      // Test track
      const aircraft1 = [{ hex: 'A1', lat: 37.6, lon: -122.4, track: 90 }];
      const { result: r1 } = renderHook(() => useTrackHistory(aircraft1, feederLat, feederLon));
      expect(r1.current.trackHistory['A1'][0].trk).toBe(90);

      // Test true_heading
      const aircraft2 = [{ hex: 'A2', lat: 37.6, lon: -122.4, true_heading: 180 }];
      const { result: r2 } = renderHook(() => useTrackHistory(aircraft2, feederLat, feederLon));
      expect(r2.current.trackHistory['A2'][0].trk).toBe(180);

      // Test mag_heading
      const aircraft3 = [{ hex: 'A3', lat: 37.6, lon: -122.4, mag_heading: 270 }];
      const { result: r3 } = renderHook(() => useTrackHistory(aircraft3, feederLat, feederLon));
      expect(r3.current.trackHistory['A3'][0].trk).toBe(270);
    });

    it('should record vertical speed', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4, baro_rate: -500 }];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123'][0].vs).toBe(-500);
    });

    it('should use geom_rate when baro_rate not available', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4, geom_rate: 1000 }];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123'][0].vs).toBe(1000);
    });

    it('should not record aircraft without position', () => {
      const aircraft = [
        { hex: 'ABC123', alt: 5000 }, // No lat/lon
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123']).toBeUndefined();
    });

    it('should not record aircraft without hex', () => {
      const aircraft = [
        { lat: 37.6, lon: -122.4, alt: 5000 }, // No hex
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(Object.keys(result.current.trackHistory)).toHaveLength(0);
    });
  });

  describe('position update throttling', () => {
    it('should not add position if less than 3 seconds since last update', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon),
        { initialProps: { aircraft } }
      );

      expect(result.current.trackHistory['ABC123']).toHaveLength(1);

      // Update at same position after 1 second
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      rerender({ aircraft: [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }] });

      // Should still be 1 point
      expect(result.current.trackHistory['ABC123']).toHaveLength(1);
    });

    it('should add position if more than 3 seconds since last update', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon),
        { initialProps: { aircraft } }
      );

      expect(result.current.trackHistory['ABC123']).toHaveLength(1);

      // Update after 4 seconds
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      rerender({ aircraft: [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }] });

      expect(result.current.trackHistory['ABC123']).toHaveLength(2);
    });

    it('should add position immediately if position changed significantly', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon),
        { initialProps: { aircraft } }
      );

      expect(result.current.trackHistory['ABC123']).toHaveLength(1);

      // Update with significant position change
      act(() => {
        vi.advanceTimersByTime(100);
      });
      rerender({ aircraft: [{ hex: 'ABC123', lat: 37.602, lon: -122.4 }] }); // > 0.001 degree change

      expect(result.current.trackHistory['ABC123']).toHaveLength(2);
    });
  });

  describe('history age management', () => {
    it('should remove positions older than maxAge', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];
      const maxAge = 60000; // 1 minute

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon, maxAge),
        { initialProps: { aircraft } }
      );

      expect(result.current.trackHistory['ABC123']).toHaveLength(1);

      // Add another point
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      rerender({ aircraft: [{ hex: 'ABC123', lat: 37.61, lon: -122.4 }] });

      expect(result.current.trackHistory['ABC123']).toHaveLength(2);

      // Advance past maxAge for first point
      act(() => {
        vi.advanceTimersByTime(55000);
      });
      rerender({ aircraft: [{ hex: 'ABC123', lat: 37.62, lon: -122.4 }] });

      // First point should be removed
      expect(result.current.trackHistory['ABC123']).toHaveLength(2);
      expect(result.current.trackHistory['ABC123'][0].lat).not.toBe(37.6);
    });

    it('should use default maxAge of 5 minutes', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon),
        { initialProps: { aircraft } }
      );

      // Advance to 4.5 minutes - point should still exist
      act(() => {
        vi.advanceTimersByTime(270000);
      });
      rerender({ aircraft: [{ hex: 'ABC123', lat: 37.65, lon: -122.4 }] });

      expect(result.current.trackHistory['ABC123'].length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('aircraft cleanup', () => {
    it('should keep track history for aircraft that disappeared recently', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon),
        { initialProps: { aircraft } }
      );

      expect(result.current.trackHistory['ABC123']).toBeDefined();

      // Aircraft disappears
      rerender({ aircraft: [] });

      // Should still have history (less than 60 seconds since last update)
      expect(result.current.trackHistory['ABC123']).toBeDefined();
    });

    it('should remove track history for aircraft gone more than 60 seconds', () => {
      const aircraft = [{ hex: 'ABC123', lat: 37.6, lon: -122.4 }];

      const { result, rerender } = renderHook(
        (props) => useTrackHistory(props.aircraft, feederLat, feederLon),
        { initialProps: { aircraft } }
      );

      expect(result.current.trackHistory['ABC123']).toBeDefined();

      // Aircraft disappears and time passes
      act(() => {
        vi.advanceTimersByTime(61000);
      });
      rerender({ aircraft: [] });

      // Should be removed
      expect(result.current.trackHistory['ABC123']).toBeUndefined();
    });
  });

  describe('multiple aircraft', () => {
    it('should track multiple aircraft independently', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 37.6, lon: -122.4 },
        { hex: 'DEF456', lat: 37.7, lon: -122.3 },
        { hex: 'GHI789', lat: 37.8, lon: -122.2 },
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(Object.keys(result.current.trackHistory)).toHaveLength(3);
      expect(result.current.trackHistory['ABC123']).toBeDefined();
      expect(result.current.trackHistory['DEF456']).toBeDefined();
      expect(result.current.trackHistory['GHI789']).toBeDefined();
    });
  });

  describe('getHistory', () => {
    it('should return history for specific aircraft', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 37.6, lon: -122.4 },
        { hex: 'DEF456', lat: 37.7, lon: -122.3 },
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      const history = result.current.getHistory('ABC123');
      expect(history).toHaveLength(1);
      expect(history[0].lat).toBe(37.6);
    });

    it('should return empty array for unknown aircraft', () => {
      const { result } = renderHook(() => useTrackHistory([], feederLat, feederLon));

      expect(result.current.getHistory('UNKNOWN')).toEqual([]);
    });
  });

  describe('getAllHistory', () => {
    it('should return all track history', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 37.6, lon: -122.4 },
        { hex: 'DEF456', lat: 37.7, lon: -122.3 },
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      const allHistory = result.current.getAllHistory();
      expect(Object.keys(allHistory)).toHaveLength(2);
    });
  });

  describe('clearHistory', () => {
    it('should clear history for specific aircraft', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 37.6, lon: -122.4 },
        { hex: 'DEF456', lat: 37.7, lon: -122.3 },
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(result.current.trackHistory['ABC123']).toBeDefined();

      act(() => {
        result.current.clearHistory('ABC123');
      });

      expect(result.current.trackHistory['ABC123']).toBeUndefined();
      expect(result.current.trackHistory['DEF456']).toBeDefined();
    });
  });

  describe('clearAllHistory', () => {
    it('should clear all track history', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 37.6, lon: -122.4 },
        { hex: 'DEF456', lat: 37.7, lon: -122.3 },
      ];

      const { result } = renderHook(() => useTrackHistory(aircraft, feederLat, feederLon));

      expect(Object.keys(result.current.trackHistory)).toHaveLength(2);

      act(() => {
        result.current.clearAllHistory();
      });

      expect(Object.keys(result.current.trackHistory)).toHaveLength(0);
    });
  });
});
