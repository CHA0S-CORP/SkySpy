import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDataBlockKeepAlive } from './useDataBlockKeepAlive';

describe('useDataBlockKeepAlive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const aircraft = [{ hex: 'abc123' }, { hex: 'DEF456' }, { noHex: true }];

  it('calls updateLastSeen immediately with uppercased active hexes', () => {
    const updateLastSeen = vi.fn();
    const pruneStaleAircraft = vi.fn();

    renderHook(() => useDataBlockKeepAlive(aircraft, updateLastSeen, pruneStaleAircraft));

    expect(updateLastSeen).toHaveBeenCalledTimes(1);
    expect(updateLastSeen).toHaveBeenCalledWith(new Set(['ABC123', 'DEF456']));
  });

  it('refreshes lastSeen every minute so long-tracked aircraft never expire', () => {
    const updateLastSeen = vi.fn();
    const pruneStaleAircraft = vi.fn();

    renderHook(() => useDataBlockKeepAlive(aircraft, updateLastSeen, pruneStaleAircraft));

    vi.advanceTimersByTime(31 * 60 * 1000); // past the 30-min expiry window

    // Initial call + one per minute
    expect(updateLastSeen.mock.calls.length).toBeGreaterThanOrEqual(31);
    expect(updateLastSeen).toHaveBeenLastCalledWith(new Set(['ABC123', 'DEF456']));
  });

  it('prunes departed aircraft on a slower cadence', () => {
    const updateLastSeen = vi.fn();
    const pruneStaleAircraft = vi.fn();

    renderHook(() => useDataBlockKeepAlive(aircraft, updateLastSeen, pruneStaleAircraft));

    expect(pruneStaleAircraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(pruneStaleAircraft).toHaveBeenCalledTimes(1);
    expect(pruneStaleAircraft).toHaveBeenCalledWith(new Set(['ABC123', 'DEF456']));
  });

  it('skips updates and pruning when the aircraft list is empty', () => {
    const updateLastSeen = vi.fn();
    const pruneStaleAircraft = vi.fn();

    renderHook(() => useDataBlockKeepAlive([], updateLastSeen, pruneStaleAircraft));

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(updateLastSeen).not.toHaveBeenCalled();
    expect(pruneStaleAircraft).not.toHaveBeenCalled();
  });

  it('uses the latest aircraft list on later ticks', () => {
    const updateLastSeen = vi.fn();
    const pruneStaleAircraft = vi.fn();

    const { rerender } = renderHook(
      ({ ac }) => useDataBlockKeepAlive(ac, updateLastSeen, pruneStaleAircraft),
      { initialProps: { ac: aircraft } }
    );

    rerender({ ac: [{ hex: 'ffff01' }] });
    vi.advanceTimersByTime(60 * 1000);

    expect(updateLastSeen).toHaveBeenLastCalledWith(new Set(['FFFF01']));
  });

  it('stops timers on unmount', () => {
    const updateLastSeen = vi.fn();
    const pruneStaleAircraft = vi.fn();

    const { unmount } = renderHook(() =>
      useDataBlockKeepAlive(aircraft, updateLastSeen, pruneStaleAircraft)
    );
    unmount();
    updateLastSeen.mockClear();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(updateLastSeen).not.toHaveBeenCalled();
    expect(pruneStaleAircraft).not.toHaveBeenCalled();
  });
});
