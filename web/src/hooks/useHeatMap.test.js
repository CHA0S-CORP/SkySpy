import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHeatMap } from './useHeatMap';

describe('useHeatMap', () => {
  let mockFetch;
  let mockWsRequest;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockWsRequest = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads historical positions over REST even when the socket is connected', async () => {
    // Regression: there is no WS 'history-positions' request type. The awaited
    // WS call rejected and — being unguarded — jumped to the outer catch,
    // skipping the REST fallback entirely, so the historical layer never loaded
    // while the socket was up.
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ lat: 47.9, lon: -122.0, timestamp: '2026-07-15T00:00:00Z' }],
        }),
    });

    const { result } = renderHook(() =>
      useHeatMap({
        enabled: true,
        feederLocation: { lat: 47.9377, lon: -121.9687 },
        wsRequest: mockWsRequest,
        wsConnected: true,
        apiBaseUrl: 'http://localhost:8000',
      })
    );

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockWsRequest).not.toHaveBeenCalledWith('history-positions', expect.anything());
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/sightings?hours='));
  });
});
