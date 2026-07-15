import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSocketIOPositions } from './useSocketIOPositions';

// Mock useSocketIO, capturing event handlers so tests can inject messages
const mockEmit = vi.fn(() => true);
let eventHandlers = {};
const mockOn = vi.fn((eventType, handler) => {
  eventHandlers[eventType] = handler;
  return vi.fn();
});

vi.mock('./useSocketIO', () => ({
  useSocketIO: vi.fn(() => ({
    connected: true,
    isReady: true,
    emit: mockEmit,
    on: mockOn,
  })),
}));

describe('useSocketIOPositions', () => {
  beforeEach(() => {
    eventHandlers = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should merge delta updated entries field-wise instead of clobbering with undefined', () => {
    const { result } = renderHook(() => useSocketIOPositions(true, '', false));

    // Full snapshot with complete position record
    act(() => {
      eventHandlers['aircraft:snapshot']({
        aircraft: [
          { hex: 'abc123', lat: 40.0, lon: -74.0, alt_baro: 35000, track: 90, gs: 450, vr: 64 },
        ],
      });
    });

    expect(result.current.getPosition('abc123')).toMatchObject({
      lat: 40.0,
      lon: -74.0,
      alt: 35000,
      track: 90,
      gs: 450,
      vr: 64,
    });

    // Backend delta 'updated' entries carry only the changed fields
    act(() => {
      eventHandlers['aircraft:update']({
        type: 'delta',
        updated: [{ hex: 'abc123', lat: 40.1, lon: -74.1 }],
      });
    });

    const pos = result.current.getPosition('abc123');
    expect(pos.lat).toBe(40.1);
    expect(pos.lon).toBe(-74.1);
    // Previously-known fields must survive the partial update
    expect(pos.alt).toBe(35000);
    expect(pos.track).toBe(90);
    expect(pos.gs).toBe(450);
    expect(pos.vr).toBe(64);
  });

  it('should not reset interpolation when a same-cycle delta repeats the current position', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(() => cb(performance.now()), 16);
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });

    try {
      const { result } = renderHook(() => useSocketIOPositions(true, '', true, 800));

      act(() => {
        eventHandlers['aircraft:snapshot']({
          aircraft: [{ hex: 'abc123', lat: 40.0, lon: -74.0, track: 90 }],
        });
      });

      // Broadcast cycle: positions:update (full) then aircraft:update delta
      // repeating the same coordinates
      act(() => {
        eventHandlers['positions:update']({
          positions: [{ hex: 'abc123', lat: 41.0, lon: -74.0, alt: 35000, track: 90, gs: 450 }],
        });
        eventHandlers['aircraft:update']({
          type: 'delta',
          updated: [{ hex: 'abc123', lat: 41.0, lon: -74.0 }],
        });
      });

      // Run one animation frame shortly after the update
      act(() => {
        vi.advanceTimersByTime(16);
      });

      const pos = result.current.getPosition('abc123');
      // Interpolation should still be in flight from 40.0 toward 41.0; if the
      // delta had reset prev=target, the position would snap to 41.0
      expect(pos.lat).toBeGreaterThanOrEqual(40.0);
      expect(pos.lat).toBeLessThan(40.9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should remove aircraft listed in delta removed array', () => {
    const { result } = renderHook(() => useSocketIOPositions(true, '', false));

    act(() => {
      eventHandlers['aircraft:snapshot']({
        aircraft: [{ hex: 'abc123', lat: 40.0, lon: -74.0, track: 90 }],
      });
    });
    expect(result.current.getPosition('abc123')).not.toBeNull();

    act(() => {
      eventHandlers['aircraft:update']({ type: 'delta', removed: ['abc123'] });
    });

    expect(result.current.getPosition('abc123')).toBeNull();
    expect(result.current.count).toBe(0);
  });
});
