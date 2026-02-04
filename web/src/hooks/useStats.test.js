import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStats } from './useStats';

describe('useStats', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should start with loading true', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useStats());

      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should have null for all stats initially', () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useStats());

      expect(result.current.trackingQuality).toBeNull();
      expect(result.current.engagement).toBeNull();
      expect(result.current.favorites).toBeNull();
      expect(result.current.flightPatterns).toBeNull();
      expect(result.current.geographicStats).toBeNull();
      expect(result.current.combinedStats).toBeNull();
    });
  });

  describe('fetching combined stats', () => {
    it('should fetch combined stats and extract individual sections', async () => {
      const combinedData = {
        tracking_quality: { score: 95 },
        engagement: { views: 100 },
        favorites: { count: 5 },
        flight_patterns: { patterns: [] },
        geographic: { regions: [] },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(combinedData),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.combinedStats).toEqual(combinedData);
      expect(result.current.trackingQuality).toEqual({ score: 95 });
      expect(result.current.engagement).toEqual({ views: 100 });
      expect(result.current.favorites).toEqual({ count: 5 });
      expect(result.current.flightPatterns).toEqual({ patterns: [] });
      expect(result.current.geographicStats).toEqual({ regions: [] });
      expect(result.current.error).toBeNull();
    });

    it('should use apiBase when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // The fetch call uses only the URL, no options object
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:8000/api/v1/stats/combined')
      );
    });

    it('should pass hours parameter', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      renderHook(() => useStats('http://localhost:8000', { hours: 48 }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // The fetch call uses only the URL, no options object
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('hours=48')
      );
    });
  });

  describe('WebSocket request mode', () => {
    it('should use wsRequest when connected', async () => {
      const wsRequest = vi.fn().mockResolvedValue({
        tracking_quality: { score: 90 },
        engagement: { views: 50 },
      });

      const { result } = renderHook(() =>
        useStats('', { wsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(wsRequest).toHaveBeenCalledWith('stats-combined', { hours: 24 });
    });

    it('should fall back to HTTP when wsRequest fails', async () => {
      const wsRequest = vi.fn().mockRejectedValue(new Error('WS Error'));

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ tracking_quality: { score: 85 } }),
      });

      const { result } = renderHook(() =>
        useStats('http://localhost:8000', { wsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should fall back to HTTP when wsRequest returns error', async () => {
      const wsRequest = vi.fn().mockResolvedValue({ error: 'Not available' });

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ tracking_quality: { score: 80 } }),
      });

      const { result } = renderHook(() =>
        useStats('http://localhost:8000', { wsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('fallback to individual endpoints', () => {
    it('should fetch individual endpoints when combined returns error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ error: 'Not implemented' }),
        })
        .mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'individual' }),
        });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should have made requests to individual endpoints
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('error handling', () => {
    it('should handle 404 errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 404 should be treated as "not available" not an error
      expect(result.current.combinedStats).toBeNull();
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Individual fetch errors are logged but don't set overall error
      expect(result.current.combinedStats).toBeNull();
    });

    it('should handle non-JSON responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.combinedStats).toBeNull();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Network errors on individual fetches don't propagate to overall error
      expect(result.current.combinedStats).toBeNull();
    });
  });

  describe('refetch', () => {
    it('should provide refetch function', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should refetch data when refetch is called', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ count: callCount }),
        });
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockFetch.mock.calls.length;

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });
  });

  describe('legacy compatibility aliases', () => {
    it('should provide sessionAnalytics as alias for engagement', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ engagement: { views: 100 } }),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sessionAnalytics).toEqual({ views: 100 });
    });

    it('should have null for timeComparison, acarsStats, achievements', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useStats('http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.timeComparison).toBeNull();
      expect(result.current.acarsStats).toBeNull();
      expect(result.current.achievements).toBeNull();
    });
  });

  describe('unmount handling', () => {
    it('should not update state after unmount', async () => {
      let resolvePromise;
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () =>
              resolve({
                ok: true,
                headers: new Headers({ 'content-type': 'application/json' }),
                json: () => Promise.resolve({ data: 'test' }),
              });
          })
      );

      const { result, unmount } = renderHook(() => useStats('http://localhost:8000'));

      expect(result.current.loading).toBe(true);

      unmount();

      // Resolve after unmount
      await act(async () => {
        resolvePromise();
      });

      // Should not throw or cause issues
    });
  });
});
