import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMapAcarsData } from './useMapAcarsData';

describe('useMapAcarsData', () => {
  let mockFetch;
  let mockWsRequest;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockWsRequest = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  const baseProps = {
    wsAcarsMessages: [],
    showAcarsPanel: false,
    config: { apiBaseUrl: 'http://localhost:8000' },
    aircraft: [],
  };

  it('loads ACARS status over HTTP even when the socket is connected', async () => {
    // Regression: there is no WS 'acars-status' request type; the WS attempt
    // rejected/returned early and the HTTP fallback was gated on !wsConnected,
    // so status never loaded while the socket was up.
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ enabled: true, message_count: 7 }),
    });

    const { result } = renderHook(() =>
      useMapAcarsData({
        ...baseProps,
        wsConnected: true,
        wsRequest: mockWsRequest,
      })
    );

    await waitFor(() => {
      expect(result.current.acarsStatus).toEqual({ enabled: true, message_count: 7 });
    });

    expect(mockWsRequest).not.toHaveBeenCalledWith('acars-status', expect.anything());
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/api/v1/acars/status');
  });
});
