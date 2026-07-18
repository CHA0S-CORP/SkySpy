import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkAircraftInfo, normalizeHexes, aggregateFlags } from './useBulkAircraftInfo';

function jsonResponse(body) {
  return Promise.resolve({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

describe('normalizeHexes', () => {
  it('dedupes, upper-cases, sorts, and caps at 100', () => {
    expect(normalizeHexes(['abc', 'ABC', ' def ', null, undefined, ''])).toEqual(['ABC', 'DEF']);
    const many = Array.from({ length: 150 }, (_, i) => `h${i}`);
    expect(normalizeHexes(many)).toHaveLength(100);
  });

  it('returns [] for non-arrays', () => {
    expect(normalizeHexes(null)).toEqual([]);
    expect(normalizeHexes(undefined)).toEqual([]);
  });
});

describe('aggregateFlags', () => {
  it('ORs is_pia/is_ladd/is_interesting across source_data', () => {
    const info = {
      source_data: [
        { source: 'a', is_pia: false, is_ladd: false, is_interesting: true },
        { source: 'b', is_pia: true, is_ladd: false, is_interesting: false },
      ],
    };
    expect(aggregateFlags(info)).toEqual({
      isPia: true,
      isLadd: false,
      isInteresting: true,
    });
  });

  it('is all-false when source_data absent or empty', () => {
    expect(aggregateFlags({})).toEqual({
      isPia: false,
      isLadd: false,
      isInteresting: false,
    });
    expect(aggregateFlags(null)).toEqual({
      isPia: false,
      isLadd: false,
      isInteresting: false,
    });
  });
});

describe('useBulkAircraftInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches the bulk endpoint and returns a keyed, flag-aggregated map', async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({
        requested: 1,
        found: 1,
        aircraft: {
          A7E198: {
            photo_thumbnail_url: 'http://x/t.jpg',
            source_data: [{ source: 'faa', is_ladd: true, is_pia: false }],
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBulkAircraftInfo(['a7e198'], ''));
    expect(result.current).toEqual({});

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/airframes/bulk?icao=A7E198');
    expect(result.current.A7E198.photo_thumbnail_url).toBe('http://x/t.jpg');
    expect(result.current.A7E198.isLadd).toBe(true);
    expect(result.current.A7E198.isPia).toBe(false);
  });

  it('does not refetch when the hex set is unchanged (only re-ordered)', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ aircraft: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = renderHook(({ hexes }) => useBulkAircraftInfo(hexes, ''), {
      initialProps: { hexes: ['aaa', 'bbb'] },
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same set, different order + casing → same sorted key → no refetch.
    rerender({ hexes: ['BBB', 'aaa'] });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A genuinely new hex → refetch.
    rerender({ hexes: ['aaa', 'bbb', 'ccc'] });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves to {} on fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network')))
    );
    const { result } = renderHook(() => useBulkAircraftInfo(['abc'], ''));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current).toEqual({});
  });

  it('does not fetch when there are no hexes', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ aircraft: {} }));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useBulkAircraftInfo([], ''));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
