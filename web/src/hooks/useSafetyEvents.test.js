import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSafetyEvents } from './useSafetyEvents';

describe('useSafetyEvents', () => {
  let mockWsRequest;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsRequest = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() => useSafetyEvents());

      expect(result.current.safetyEvents).toEqual([]);
      expect(result.current.activeConflicts).toEqual([]);
      expect(result.current.proximityConflicts).toEqual([]);
      expect(result.current.unacknowledgedEvents).toEqual([]);
      expect(result.current.unacknowledgedConflicts).toEqual([]);
      expect(result.current.acknowledgedEvents.size).toBe(0);
      expect(result.current.acknowledgedConflicts.size).toBe(0);
    });
  });

  describe('merging WebSocket safety events', () => {
    it('should merge incoming WebSocket events', () => {
      const wsSafetyEvents = [
        { id: 'event-1', event_type: 'proximity', timestamp: new Date().toISOString() },
        { id: 'event-2', event_type: 'tcas', timestamp: new Date().toISOString() },
      ];

      const { result } = renderHook(() => useSafetyEvents(wsSafetyEvents));

      expect(result.current.safetyEvents).toHaveLength(2);
    });

    it('should not duplicate existing events', () => {
      const wsSafetyEvents = [
        { id: 'event-1', event_type: 'proximity', timestamp: new Date().toISOString() },
      ];

      const { result, rerender } = renderHook((props) => useSafetyEvents(props.wsSafetyEvents), {
        initialProps: { wsSafetyEvents },
      });

      expect(result.current.safetyEvents).toHaveLength(1);

      // Send same event again
      rerender({ wsSafetyEvents: [...wsSafetyEvents] });

      expect(result.current.safetyEvents).toHaveLength(1);
    });

    it('should limit events to 50 items', () => {
      const wsSafetyEvents = Array.from({ length: 60 }, (_, i) => ({
        id: `event-${i}`,
        event_type: 'proximity',
        timestamp: new Date().toISOString(),
      }));

      const { result } = renderHook(() => useSafetyEvents(wsSafetyEvents));

      expect(result.current.safetyEvents.length).toBeLessThanOrEqual(50);
    });

    it('should add new events to beginning', () => {
      const { result, rerender } = renderHook((props) => useSafetyEvents(props.wsSafetyEvents), {
        initialProps: { wsSafetyEvents: [{ id: 'event-1', timestamp: new Date().toISOString() }] },
      });

      rerender({ wsSafetyEvents: [{ id: 'event-2', timestamp: new Date().toISOString() }] });

      expect(result.current.safetyEvents[0].id).toBe('event-2');
    });
  });

  describe('fetching safety events via WebSocket', () => {
    it('should fetch events when connected', async () => {
      const mockEvents = [
        { id: 'event-1', event_type: 'proximity' },
        { id: 'event-2', event_type: 'tcas' },
      ];

      mockWsRequest.mockResolvedValue({ events: mockEvents });

      const { result } = renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      // Wait for initial delay + fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockWsRequest).toHaveBeenCalledWith('safety-events', { limit: 20 });
    });

    it('should handle various response formats', async () => {
      // Test results format (DRF paginated)
      mockWsRequest.mockResolvedValue({
        results: [{ id: 'event-1' }],
      });

      const { result } = renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(result.current.safetyEvents).toHaveLength(1);
    });

    it('should handle data.events format', async () => {
      mockWsRequest.mockResolvedValue({
        data: { events: [{ id: 'event-1' }] },
      });

      const { result } = renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(result.current.safetyEvents).toHaveLength(1);
    });

    it('should handle array response', async () => {
      mockWsRequest.mockResolvedValue([{ id: 'event-1' }]);

      const { result } = renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(result.current.safetyEvents).toHaveLength(1);
    });

    it('should debounce fetch requests', async () => {
      mockWsRequest.mockResolvedValue({ events: [] });

      renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      // First fetch after delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      // Another quick fetch should be debounced
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);
    });

    it('should refresh periodically', async () => {
      mockWsRequest.mockResolvedValue({ events: [] });

      renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      // Wait past debounce (10s) + refresh interval (30s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(2);
    });

    it('should handle timeout errors silently', async () => {
      mockWsRequest.mockRejectedValue(new Error('Request timeout'));

      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      // Should not log timeout errors
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('active conflicts', () => {
    it('should filter events from last 60 seconds as active', () => {
      const now = Date.now();
      const recentEvent = {
        id: 'event-1',
        event_type: 'proximity',
        timestamp: new Date(now - 30000).toISOString(), // 30 seconds ago
        icao: 'ABC123',
        callsign: 'UAL123',
      };
      const oldEvent = {
        id: 'event-2',
        event_type: 'proximity',
        timestamp: new Date(now - 120000).toISOString(), // 2 minutes ago
        icao: 'DEF456',
      };

      const { result } = renderHook(() => useSafetyEvents([recentEvent, oldEvent]));

      expect(result.current.activeConflicts).toHaveLength(1);
      expect(result.current.activeConflicts[0].id).toBe('event-1');
    });

    it('should exclude acknowledged events from active conflicts', () => {
      const recentEvent = {
        id: 'event-1',
        event_type: 'proximity',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
      };

      const { result } = renderHook(() => useSafetyEvents([recentEvent]));

      expect(result.current.activeConflicts).toHaveLength(1);

      act(() => {
        result.current.acknowledgeEvent('event-1');
      });

      expect(result.current.activeConflicts).toHaveLength(0);
    });

    it('should calculate live separation for two-aircraft events', () => {
      const event = {
        id: 'event-1',
        event_type: 'proximity',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
        icao_2: 'DEF456',
        callsign: 'UAL123',
        callsign_2: 'DAL456',
      };

      const aircraft = [
        { hex: 'ABC123', lat: 37.5, lon: -122.5, alt: 5000 },
        { hex: 'DEF456', lat: 37.6, lon: -122.4, alt: 6000 },
      ];

      const { result } = renderHook(() => useSafetyEvents([event], aircraft));

      const conflict = result.current.activeConflicts[0];
      expect(conflict.horizontalNm).not.toBe('--');
      expect(conflict.verticalFt).toBe(1000); // Math.abs(6000 - 5000)
    });

    it('should show altitude for single-aircraft events', () => {
      const event = {
        id: 'event-1',
        event_type: 'low_altitude',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
        callsign: 'UAL123',
      };

      const aircraft = [{ hex: 'ABC123', lat: 37.5, lon: -122.5, alt: 500 }];

      const { result } = renderHook(() => useSafetyEvents([event], aircraft));

      expect(result.current.activeConflicts[0].verticalFt).toBe(500);
    });

    it('should show vertical speed for vs events', () => {
      const event = {
        id: 'event-1',
        event_type: 'rapid_descent_vs',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
      };

      const aircraft = [{ hex: 'ABC123', alt: 5000, baro_rate: -3000 }];

      const { result } = renderHook(() => useSafetyEvents([event], aircraft));

      expect(result.current.activeConflicts[0].verticalFt).toContain('fpm');
    });
  });

  describe('acknowledging events', () => {
    it('should acknowledge a single event', () => {
      const event = {
        id: 'event-1',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
      };

      const { result } = renderHook(() => useSafetyEvents([event]));

      expect(result.current.unacknowledgedEvents).toHaveLength(1);

      act(() => {
        result.current.acknowledgeEvent('event-1');
      });

      expect(result.current.acknowledgedEvents.has('event-1')).toBe(true);
      expect(result.current.unacknowledgedEvents).toHaveLength(0);
    });

    it('should acknowledge events by severity', () => {
      const events = [
        {
          id: 'event-1',
          severity: 'critical',
          timestamp: new Date().toISOString(),
          icao: 'ABC123',
        },
        {
          id: 'event-2',
          severity: 'critical',
          timestamp: new Date().toISOString(),
          icao: 'DEF456',
        },
        { id: 'event-3', severity: 'warning', timestamp: new Date().toISOString(), icao: 'GHI789' },
      ];

      const { result } = renderHook(() => useSafetyEvents(events));

      act(() => {
        result.current.acknowledgeEventsBySeverity('critical');
      });

      expect(result.current.acknowledgedEvents.has('event-1')).toBe(true);
      expect(result.current.acknowledgedEvents.has('event-2')).toBe(true);
      expect(result.current.acknowledgedEvents.has('event-3')).toBe(false);
    });
  });

  describe('proximity conflicts', () => {
    it('should track proximity conflicts separately', () => {
      const { result } = renderHook(() => useSafetyEvents());

      act(() => {
        result.current.setProximityConflicts([
          { hex1: 'ABC123', hex2: 'DEF456', distance_nm: 0.5 },
        ]);
      });

      expect(result.current.proximityConflicts).toHaveLength(1);
    });

    it('should acknowledge proximity conflict', () => {
      const { result } = renderHook(() => useSafetyEvents());

      act(() => {
        result.current.setProximityConflicts([
          { hex1: 'ABC123', hex2: 'DEF456', distance_nm: 0.5 },
        ]);
      });

      expect(result.current.unacknowledgedConflicts).toHaveLength(1);

      act(() => {
        result.current.acknowledgeConflict({ hex1: 'ABC123', hex2: 'DEF456' });
      });

      expect(result.current.unacknowledgedConflicts).toHaveLength(0);
      expect(result.current.acknowledgedConflicts.has('ABC123-DEF456')).toBe(true);
    });

    it('should cleanup acknowledged conflicts when no longer active', () => {
      const { result } = renderHook(() => useSafetyEvents());

      act(() => {
        result.current.setProximityConflicts([
          { hex1: 'ABC123', hex2: 'DEF456', distance_nm: 0.5 },
        ]);
        result.current.acknowledgeConflict({ hex1: 'ABC123', hex2: 'DEF456' });
      });

      expect(result.current.acknowledgedConflicts.size).toBe(1);

      // Clear all conflicts
      act(() => {
        result.current.setProximityConflicts([]);
      });

      expect(result.current.acknowledgedConflicts.size).toBe(0);
    });
  });

  describe('aircraft conflict detection', () => {
    it('should check if aircraft is in conflict', () => {
      const event = {
        id: 'event-1',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
        icao_2: 'DEF456',
      };

      const { result } = renderHook(() => useSafetyEvents([event]));

      expect(result.current.isAircraftInConflict('ABC123')).toBe(true);
      expect(result.current.isAircraftInConflict('DEF456')).toBe(true);
      expect(result.current.isAircraftInConflict('GHI789')).toBe(false);
    });

    it('should check proximity conflicts for aircraft', () => {
      const { result } = renderHook(() => useSafetyEvents());

      act(() => {
        result.current.setProximityConflicts([
          { hex1: 'ABC123', hex2: 'DEF456', distance_nm: 0.5 },
        ]);
      });

      expect(result.current.isAircraftInConflict('ABC123')).toBe(true);
      expect(result.current.isAircraftInConflict('DEF456')).toBe(true);
    });

    it('should get conflict for specific aircraft', () => {
      const event = {
        id: 'event-1',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
        event_type: 'proximity',
      };

      const { result } = renderHook(() => useSafetyEvents([event]));

      const conflict = result.current.getAircraftConflict('ABC123');
      expect(conflict).toBeDefined();
      expect(conflict.id).toBe('event-1');
    });

    it('should return undefined for aircraft not in conflict', () => {
      const { result } = renderHook(() => useSafetyEvents([]));

      expect(result.current.getAircraftConflict('ABC123')).toBeUndefined();
    });

    it('should handle case-insensitive hex matching', () => {
      const event = {
        id: 'event-1',
        timestamp: new Date().toISOString(),
        icao: 'ABC123',
      };

      const { result } = renderHook(() => useSafetyEvents([event]));

      expect(result.current.isAircraftInConflict('abc123')).toBe(true);
      expect(result.current.isAircraftInConflict('AbC123')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup on unmount', async () => {
      mockWsRequest.mockResolvedValue({ events: [] });

      const { unmount } = renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      unmount();

      // Should not throw or cause issues after unmount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
    });

    it('should abort pending requests on cleanup', async () => {
      let resolveRequest;
      mockWsRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRequest = () => resolve({ events: [] });
          })
      );

      const { unmount } = renderHook(() => useSafetyEvents([], [], mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      unmount();

      // Resolve after unmount - should not cause issues
      await act(async () => {
        resolveRequest?.();
      });
    });
  });
});
