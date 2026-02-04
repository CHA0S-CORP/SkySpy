import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionStats } from './useSessionStats';

describe('useSessionStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should return initial stats with zero values', () => {
      const { result } = renderHook(() => useSessionStats([]));

      expect(result.current.uniqueAircraftCount).toBe(0);
      expect(result.current.currentCount).toBe(0);
      expect(result.current.peakSimultaneousCount).toBe(0);
      expect(result.current.maxRangeNm).toBe(0);
      expect(result.current.totalPositionUpdates).toBe(0);
      expect(result.current.categoryBreakdown).toEqual({});
      expect(result.current.topAircraftTypes).toEqual([]);
    });

    it('should have session start time set to now', () => {
      const now = Date.now();
      const { result } = renderHook(() => useSessionStats([]));

      expect(result.current.sessionStartTime).toBeGreaterThanOrEqual(now);
    });

    it('should format session duration as 0s initially', () => {
      const { result } = renderHook(() => useSessionStats([]));

      expect(result.current.sessionDurationFormatted).toBe('0s');
    });
  });

  describe('aircraft tracking', () => {
    it('should track unique aircraft', async () => {
      const aircraft = [
        { hex: 'ABC123', lat: 47.5, lon: -122.3 },
        { hex: 'DEF456', lat: 47.6, lon: -122.4 },
        { hex: 'ABC123', lat: 47.55, lon: -122.35 }, // duplicate
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      // Advance timers to trigger stats update
      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.uniqueAircraftCount).toBe(2);
      });
    });

    it('should track current count based on aircraft with position', async () => {
      const aircraft = [
        { hex: 'ABC123', lat: 47.5, lon: -122.3 },
        { hex: 'DEF456' }, // no position
        { hex: 'GHI789', lat: 47.7, lon: -122.5 },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.currentCount).toBe(2);
      });
    });

    it('should track peak simultaneous count', async () => {
      const { result, rerender } = renderHook(({ ac }) => useSessionStats(ac), {
        initialProps: {
          ac: [
            { hex: 'AC1', lat: 47.5, lon: -122.3 },
            { hex: 'AC2', lat: 47.6, lon: -122.4 },
          ],
        },
      });

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      // Update to more aircraft
      rerender({
        ac: [
          { hex: 'AC1', lat: 47.5, lon: -122.3 },
          { hex: 'AC2', lat: 47.6, lon: -122.4 },
          { hex: 'AC3', lat: 47.7, lon: -122.5 },
          { hex: 'AC4', lat: 47.8, lon: -122.6 },
        ],
      });

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      // Go back to fewer
      rerender({
        ac: [{ hex: 'AC1', lat: 47.5, lon: -122.3 }],
      });

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.peakSimultaneousCount).toBe(4);
        expect(result.current.currentCount).toBe(1);
      });
    });

    it('should track max range', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3, distance_nm: 25 },
        { hex: 'AC2', lat: 47.6, lon: -122.4, distance_nm: 100 },
        { hex: 'AC3', lat: 47.7, lon: -122.5, distance_nm: 50 },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.maxRangeNm).toBe(100);
        expect(result.current.maxRangeAircraft).toBe('AC2');
      });
    });

    it('should update max range when new aircraft with greater range appears', async () => {
      const { result, rerender } = renderHook(({ ac }) => useSessionStats(ac), {
        initialProps: {
          ac: [{ hex: 'AC1', lat: 47.5, lon: -122.3, distance_nm: 50 }],
        },
      });

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.maxRangeNm).toBe(50);
      });

      rerender({
        ac: [
          { hex: 'AC1', lat: 47.5, lon: -122.3, distance_nm: 50 },
          { hex: 'AC2', lat: 47.8, lon: -122.6, distance_nm: 150 },
        ],
      });

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.maxRangeNm).toBe(150);
        expect(result.current.maxRangeAircraft).toBe('AC2');
      });
    });
  });

  describe('category breakdown', () => {
    it('should track aircraft by category', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3, category: 'A1' },
        { hex: 'AC2', lat: 47.6, lon: -122.4, category: 'A3' },
        { hex: 'AC3', lat: 47.7, lon: -122.5, category: 'A1' },
        { hex: 'AC4', lat: 47.8, lon: -122.6, category: 'A5' },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.categoryBreakdown).toEqual({
          Light: 2, // A1 -> "Light"
          Large: 1, // A3 -> "Large"
          Heavy: 1, // A5 -> "Heavy"
        });
      });
    });

    it('should handle unknown categories', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3 }, // no category
        { hex: 'AC2', lat: 47.6, lon: -122.4, category: 'A1' },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.categoryBreakdown).toHaveProperty('Unknown');
        expect(result.current.categoryBreakdown).toHaveProperty('Light');
      });
    });
  });

  describe('top aircraft types', () => {
    it('should track top 5 aircraft types', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3, t: 'B738' },
        { hex: 'AC2', lat: 47.6, lon: -122.4, t: 'B738' },
        { hex: 'AC3', lat: 47.7, lon: -122.5, t: 'A320' },
        { hex: 'AC4', lat: 47.8, lon: -122.6, t: 'B738' },
        { hex: 'AC5', lat: 47.9, lon: -122.7, t: 'C172' },
        { hex: 'AC6', lat: 48.0, lon: -122.8, t: 'A320' },
        { hex: 'AC7', lat: 48.1, lon: -122.9, t: 'E175' },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.topAircraftTypes.length).toBeLessThanOrEqual(5);
        expect(result.current.topAircraftTypes[0]).toEqual({ type: 'B738', count: 3 });
        expect(result.current.topAircraftTypes[1]).toEqual({ type: 'A320', count: 2 });
      });
    });

    it('should exclude Unknown types', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3 }, // no type
        { hex: 'AC2', lat: 47.6, lon: -122.4, t: 'B738' },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        const hasUnknown = result.current.topAircraftTypes.some((item) => item.type === 'Unknown');
        expect(hasUnknown).toBe(false);
      });
    });
  });

  describe('session duration', () => {
    it('should update duration over time', async () => {
      const { result } = renderHook(() => useSessionStats([]));

      expect(result.current.sessionDurationFormatted).toBe('0s');

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(result.current.sessionDurationFormatted).toBe('5s');
      });

      act(() => {
        vi.advanceTimersByTime(55000); // +55s = 60s total
      });

      await waitFor(() => {
        expect(result.current.sessionDurationFormatted).toBe('1m 0s');
      });

      act(() => {
        vi.advanceTimersByTime(3540000); // +59 min = 60 min total
      });

      await waitFor(() => {
        expect(result.current.sessionDurationFormatted).toBe('1h 0m 0s');
      });
    });
  });

  describe('position updates', () => {
    it('should count position updates', async () => {
      const aircraft1 = [
        { hex: 'AC1', lat: 47.5, lon: -122.3 },
        { hex: 'AC2', lat: 47.6, lon: -122.4 },
      ];

      const { result, rerender } = renderHook(({ ac }) => useSessionStats(ac), {
        initialProps: { ac: aircraft1 },
      });

      // Initial render + first update interval
      act(() => {
        vi.advanceTimersByTime(2500);
      });

      const firstCount = result.current.totalPositionUpdates;
      expect(firstCount).toBeGreaterThan(0);

      // Rerender with same data (simulates new position update)
      rerender({ ac: aircraft1 });

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.totalPositionUpdates).toBeGreaterThan(firstCount);
      });
    });
  });

  describe('reset session', () => {
    it('should reset all stats when resetSession is called', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3, distance_nm: 50, category: 'A1', t: 'B738' },
        { hex: 'AC2', lat: 47.6, lon: -122.4, distance_nm: 100, category: 'A3', t: 'A320' },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Verify we have data
      await waitFor(() => {
        expect(result.current.uniqueAircraftCount).toBeGreaterThan(0);
      });

      // Reset
      act(() => {
        result.current.resetSession();
      });

      // Verify reset
      expect(result.current.uniqueAircraftCount).toBe(0);
      expect(result.current.peakSimultaneousCount).toBe(0);
      expect(result.current.maxRangeNm).toBe(0);
      expect(result.current.totalPositionUpdates).toBe(0);
      expect(result.current.categoryBreakdown).toEqual({});
      expect(result.current.topAircraftTypes).toEqual([]);
      expect(result.current.sessionDurationFormatted).toBe('0s');
    });
  });

  describe('enabled option', () => {
    it('should not track stats when disabled', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3, distance_nm: 50 },
        { hex: 'AC2', lat: 47.6, lon: -122.4, distance_nm: 100 },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft, { enabled: false }));

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Stats should remain at initial values
      expect(result.current.uniqueAircraftCount).toBe(0);
      expect(result.current.maxRangeNm).toBe(0);
    });
  });

  describe('peak time formatting', () => {
    it('should format peak time when available', async () => {
      const aircraft = [
        { hex: 'AC1', lat: 47.5, lon: -122.3 },
        { hex: 'AC2', lat: 47.6, lon: -122.4 },
      ];

      const { result } = renderHook(() => useSessionStats(aircraft));

      act(() => {
        vi.advanceTimersByTime(2500);
      });

      await waitFor(() => {
        expect(result.current.peakTimeFormatted).toBeTruthy();
        // Should be a valid time string (e.g., "12:30:45 PM")
        expect(result.current.peakTimeFormatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
      });
    });

    it('should return null for peak time when no aircraft have been tracked', () => {
      const { result } = renderHook(() => useSessionStats([]));

      expect(result.current.peakTimeFormatted).toBeNull();
    });
  });
});
