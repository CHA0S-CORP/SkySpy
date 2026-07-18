import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReplayState } from './useReplayState';

// Mock Leaflet since we can't render maps in tests
vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => ({
      setView: vi.fn(),
      remove: vi.fn(),
      removeLayer: vi.fn(),
      fitBounds: vi.fn(),
    })),
    marker: vi.fn(() => ({
      addTo: vi.fn(() => ({ bindPopup: vi.fn() })),
    })),
    polyline: vi.fn(() => ({
      addTo: vi.fn(),
    })),
    divIcon: vi.fn(() => ({})),
    tileLayer: vi.fn(() => ({
      addTo: vi.fn(),
    })),
    latLngBounds: vi.fn(() => ({
      pad: vi.fn(() => ({})),
    })),
  },
}));

describe('useReplayState', () => {
  const defaultProps = {
    apiBase: 'http://localhost:8000',
    wsRequest: vi.fn(),
    wsConnected: false,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(() => cb(performance.now()), 16);
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should start with empty state', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      expect(result.current.expandedMaps).toEqual({});
      expect(result.current.trackData).toEqual({});
      expect(result.current.replayState).toEqual({});
      expect(result.current.graphZoomState).toEqual({});
    });
  });

  describe('getInterpolatedPosition', () => {
    it('should return null for empty track', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      expect(result.current.getInterpolatedPosition([], 50)).toBeNull();
      expect(result.current.getInterpolatedPosition(null, 50)).toBeNull();
    });

    it('should return single point for track with one element', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));
      const track = [{ lat: 40, lon: -74, altitude: 10000 }];

      const pos = result.current.getInterpolatedPosition(track, 50);

      expect(pos.lat).toBe(40);
      expect(pos.lon).toBe(-74);
      expect(pos.index).toBe(0);
    });

    it('should return first point at 0%', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));
      // Track is newest first, so we reverse for timeline order
      const track = [
        { lat: 42, lon: -72, timestamp: '2024-01-01T12:02:00Z' }, // newest
        { lat: 41, lon: -73, timestamp: '2024-01-01T12:01:00Z' },
        { lat: 40, lon: -74, timestamp: '2024-01-01T12:00:00Z' }, // oldest
      ];

      const pos = result.current.getInterpolatedPosition(track, 0);

      // At 0%, we should get the oldest point (first in timeline order)
      expect(pos.lat).toBe(40);
      expect(pos.lon).toBe(-74);
      expect(pos.index).toBe(0);
    });

    it('should return last point at 100%', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));
      const track = [
        { lat: 42, lon: -72, timestamp: '2024-01-01T12:02:00Z' },
        { lat: 41, lon: -73, timestamp: '2024-01-01T12:01:00Z' },
        { lat: 40, lon: -74, timestamp: '2024-01-01T12:00:00Z' },
      ];

      const pos = result.current.getInterpolatedPosition(track, 100);

      // At 100%, we should get the newest point (last in timeline order)
      expect(pos.lat).toBe(42);
      expect(pos.lon).toBe(-72);
      expect(pos.index).toBe(2);
    });

    it('should interpolate at 50%', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));
      const track = [
        { lat: 42, lon: -72 },
        { lat: 41, lon: -73 },
        { lat: 40, lon: -74 },
      ];

      const pos = result.current.getInterpolatedPosition(track, 50);

      // At 50% of 3 points (indices 0-2), index = floor(0.5 * 2) = 1
      expect(pos.lat).toBe(41);
      expect(pos.lon).toBe(-73);
      expect(pos.index).toBe(1);
    });
  });

  describe('toggleMap', () => {
    it('should toggle map expansion state', async () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      act(() => {
        result.current.toggleMap('event1', null);
      });

      expect(result.current.expandedMaps['event1']).toBe(true);

      act(() => {
        result.current.toggleMap('event1', null);
      });

      expect(result.current.expandedMaps['event1']).toBe(false);
    });

    it('should fetch track data when opening with event via WebSocket', async () => {
      vi.useRealTimers(); // Use real timers for this async test

      const wsRequest = vi.fn().mockResolvedValue({ sightings: [] });
      const { result } = renderHook(() =>
        useReplayState({ ...defaultProps, wsRequest, wsConnected: true })
      );
      const event = { icao: 'ABC123' };

      await act(async () => {
        await result.current.toggleMap('event1', event);
      });

      expect(wsRequest).toHaveBeenCalledWith('sightings', {
        icao_hex: 'ABC123',
        hours: 2,
        limit: 500,
      });

      expect(result.current.replayState['event1']).toBeDefined();
      expect(result.current.replayState['event1'].position).toBe(50);
      expect(result.current.replayState['event1'].isPlaying).toBe(false);
      expect(result.current.replayState['event1'].speed).toBe(1);
    });
  });

  describe('handleReplayChange', () => {
    it('should update replay position', async () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // First set up replay state
      act(() => {
        result.current.toggleMap('event1', null);
      });

      // Manually set initial replay state
      act(() => {
        result.current.handleReplayChange('event1', {}, 50);
      });

      expect(result.current.replayState['event1'].position).toBe(50);
    });
  });

  describe('skipToStart', () => {
    it('should set position to 0 and stop playing', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state
      act(() => {
        result.current.handleReplayChange('event1', {}, 75);
      });

      act(() => {
        result.current.skipToStart('event1', {});
      });

      expect(result.current.replayState['event1'].position).toBe(0);
      expect(result.current.replayState['event1'].isPlaying).toBe(false);
    });
  });

  describe('skipToEnd', () => {
    it('should set position to 100 and stop playing', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state
      act(() => {
        result.current.handleReplayChange('event1', {}, 25);
      });

      act(() => {
        result.current.skipToEnd('event1', {});
      });

      expect(result.current.replayState['event1'].position).toBe(100);
      expect(result.current.replayState['event1'].isPlaying).toBe(false);
    });
  });

  describe('handleSpeedChange', () => {
    it('should update playback speed', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state
      act(() => {
        result.current.handleReplayChange('event1', {}, 50);
      });

      act(() => {
        result.current.handleSpeedChange('event1', 2);
      });

      expect(result.current.replayState['event1'].speed).toBe(2);
    });
  });

  describe('jumpToEvent', () => {
    it('should jump to 50% position', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state
      act(() => {
        result.current.handleReplayChange('event1', {}, 25);
      });

      act(() => {
        result.current.jumpToEvent('event1', {});
      });

      expect(result.current.replayState['event1'].position).toBe(50);
      expect(result.current.replayState['event1'].isPlaying).toBe(false);
    });

    it('should preserve speed when jumping', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state with custom speed
      act(() => {
        result.current.handleReplayChange('event1', {}, 25);
        result.current.handleSpeedChange('event1', 2);
      });

      act(() => {
        result.current.jumpToEvent('event1', {});
      });

      expect(result.current.replayState['event1'].speed).toBe(2);
    });
  });

  describe('graph zoom controls', () => {
    it('should handle zoom in via wheel', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Zoom in (negative deltaY)
      act(() => {
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(1.25);
      expect(result.current.graphZoomState['event1'].offset).toBe(0);
    });

    it('should handle zoom out via wheel', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // First zoom in
      act(() => {
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(1.5);

      // Then zoom out
      act(() => {
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: 100,
        });
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(1.25);
    });

    it('should not zoom below 1', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      act(() => {
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: 100, // zoom out
        });
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(1);
    });

    it('should not zoom above 8', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Zoom in many times
      act(() => {
        for (let i = 0; i < 40; i++) {
          result.current.handleGraphWheel('event1', {
            preventDefault: vi.fn(),
            deltaY: -100,
          });
        }
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(8);
    });

    it('should reset zoom', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Zoom in first
      act(() => {
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(1.5);

      // Reset
      act(() => {
        result.current.resetGraphZoom('event1');
      });

      expect(result.current.graphZoomState['event1'].zoom).toBe(1);
      expect(result.current.graphZoomState['event1'].offset).toBe(0);
    });
  });

  describe('graph drag', () => {
    it('should track drag state', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // First zoom in so drag is enabled
      act(() => {
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
        result.current.handleGraphWheel('event1', {
          preventDefault: vi.fn(),
          deltaY: -100,
        });
      });

      expect(result.current.graphZoomState['event1'].zoom).toBeGreaterThan(1);

      // Start drag
      act(() => {
        result.current.handleGraphDragStart('event1', { clientX: 100 });
      });

      // Move drag
      act(() => {
        result.current.handleGraphDragMove('event1', { clientX: 80 });
      });

      // Offset should have changed (dragging left increases offset)
      expect(result.current.graphZoomState['event1'].offset).toBeGreaterThan(0);

      // End drag
      act(() => {
        result.current.handleGraphDragEnd('event1');
      });
    });

    it('should not drag when zoom is 1', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      act(() => {
        result.current.handleGraphDragStart('event1', { clientX: 100 });
        result.current.handleGraphDragMove('event1', { clientX: 80 });
      });

      // No graphZoomState should be set (drag ignored)
      expect(result.current.graphZoomState['event1']).toBeUndefined();
    });
  });

  describe('getReplayTimestamp', () => {
    it('should return null when no replay state exists', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      const timestamp = result.current.getReplayTimestamp('event1', { icao: 'ABC123' });

      expect(timestamp).toBeNull();
    });

    it('should return null when no track data exists', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up replay state but no track data
      act(() => {
        result.current.handleReplayChange('event1', {}, 50);
      });

      const timestamp = result.current.getReplayTimestamp('event1', { icao: 'ABC123' });

      expect(timestamp).toBeNull();
    });
  });

  describe('togglePlay', () => {
    it('should do nothing if no replay state exists', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Should not throw
      act(() => {
        result.current.togglePlay('event1', {});
      });

      expect(result.current.replayState['event1']).toBeUndefined();
    });

    it('should toggle isPlaying state', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state
      act(() => {
        result.current.handleReplayChange('event1', {}, 50);
      });

      expect(result.current.replayState['event1'].isPlaying).toBeFalsy();

      // Toggle play
      act(() => {
        result.current.togglePlay('event1', {});
      });

      expect(result.current.replayState['event1'].isPlaying).toBe(true);

      // Toggle pause
      act(() => {
        result.current.togglePlay('event1', {});
      });

      expect(result.current.replayState['event1'].isPlaying).toBe(false);
    });

    it('should adopt a slider drag while playing instead of snapping back', () => {
      const { result } = renderHook(() => useReplayState(defaultProps));

      // Set up initial state at 50%
      act(() => {
        result.current.handleReplayChange('event1', {}, 50);
      });

      // Start playing and let a few frames run
      act(() => {
        result.current.togglePlay('event1', {});
      });
      act(() => {
        vi.advanceTimersByTime(48);
      });

      // Drag the slider back to 10 while playback is running
      act(() => {
        result.current.handleReplayChange('event1', {}, 10);
      });

      // The next frame must continue from the dragged position, not the
      // loop's internally-tracked pre-drag position (~50)
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.replayState['event1'].isPlaying).toBe(true);
      expect(result.current.replayState['event1'].position).toBeLessThan(20);
    });
  });
});
