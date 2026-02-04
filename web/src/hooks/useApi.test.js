import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi, parseDRFError } from './useApi';

describe('useApi', () => {
  let mockFetch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('parseDRFError', () => {
    it('should return "Unknown error" for null/undefined data', () => {
      expect(parseDRFError(null)).toBe('Unknown error');
      expect(parseDRFError(undefined)).toBe('Unknown error');
    });

    it('should return string data as-is', () => {
      expect(parseDRFError('Simple error')).toBe('Simple error');
    });

    it('should parse detail field', () => {
      expect(parseDRFError({ detail: 'Not found' })).toBe('Not found');
      expect(parseDRFError({ detail: { code: 'ERR' } })).toBe('{"code":"ERR"}');
    });

    it('should parse non_field_errors', () => {
      expect(parseDRFError({ non_field_errors: ['Error 1', 'Error 2'] })).toBe('Error 1, Error 2');
      expect(parseDRFError({ non_field_errors: 'Single error' })).toBe('Single error');
    });

    it('should parse field validation errors', () => {
      const data = {
        email: ['Invalid email format'],
        password: ['Too short', 'Must contain number'],
      };
      const result = parseDRFError(data);
      expect(result).toContain('email: Invalid email format');
      expect(result).toContain('password: Too short, Must contain number');
    });

    it('should handle field errors as strings', () => {
      const data = {
        username: 'Already taken',
      };
      expect(parseDRFError(data)).toBe('username: Already taken');
    });

    it('should fallback to JSON.stringify for unknown formats', () => {
      const data = { nested: { unknown: true } };
      expect(parseDRFError(data)).toBe('{"nested":{"unknown":true}}');
    });
  });

  describe('basic fetch behavior', () => {
    it('should start with loading state', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useApi('/api/v1/test'));

      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should fetch data on mount', async () => {
      vi.useRealTimers();

      const mockData = { results: [{ id: 1 }] };
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockData),
      });

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(result.current.error).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/test', expect.any(Object));
    });

    it('should use apiBase when provided', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'test' }),
      });

      const { result } = renderHook(() => useApi('/api/v1/test', null, 'http://localhost:8000'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/test',
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should handle HTTP errors with DRF error response', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ detail: 'Bad request' }),
      });

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Bad request');
      expect(result.current.data).toBeNull();
    });

    it('should handle HTTP errors without JSON response', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('HTTP 500');
    });

    it('should handle network errors', async () => {
      vi.useRealTimers();

      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
    });

    it('should handle invalid JSON response', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Invalid response format');
    });

    it('should handle non-JSON content type', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
      });

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Invalid response format');
    });
  });

  describe('polling behavior', () => {
    it('should poll at specified interval', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ count: 0 }),
      });

      renderHook(() => useApi('/api/v1/test', 5000));

      // Wait for initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance to first interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Advance to second interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should stop polling when unmounted', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ count: 0 }),
      });

      const { unmount } = renderHook(() => useApi('/api/v1/test', 5000));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // Should not have made additional calls after unmount
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not poll when interval is null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'test' }),
      });

      renderHook(() => useApi('/api/v1/test', null));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // Should only have initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('refetch functionality', () => {
    it('should refetch data when refetch is called', async () => {
      vi.useRealTimers();

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ count: callCount }),
        });
      });

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual({ count: 1 });

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.data).toEqual({ count: 2 });
      });
    });

    it('should set loading state on refetch', async () => {
      vi.useRealTimers();

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

      const { result } = renderHook(() => useApi('/api/v1/test'));

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.refetch();
      });

      expect(result.current.loading).toBe(true);
    });
  });

  describe('abort behavior', () => {
    it('should abort previous request on new fetch', async () => {
      vi.useRealTimers();

      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: 'test' }),
        })
      );

      const { result } = renderHook(() => useApi('/api/v1/test'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.refetch();
      });

      // Previous request should have been aborted
      expect(abortSpy).toHaveBeenCalled();

      abortSpy.mockRestore();
    });

    it('should abort request on unmount', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { unmount } = renderHook(() => useApi('/api/v1/test'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      unmount();

      expect(abortSpy).toHaveBeenCalled();

      abortSpy.mockRestore();
    });

    it('should ignore AbortError', async () => {
      vi.useRealTimers();

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const { result, unmount } = renderHook(() => useApi('/api/v1/test'));

      // Wait a bit then unmount to trigger abort
      await new Promise((r) => setTimeout(r, 50));
      unmount();

      // Error should not be set for AbortError
      expect(result.current.error).toBeNull();
    });
  });

  describe('endpoint changes', () => {
    it('should refetch when endpoint changes', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'test' }),
      });

      const { result, rerender } = renderHook(({ endpoint }) => useApi(endpoint), {
        initialProps: { endpoint: '/api/v1/test1' },
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/test1', expect.any(Object));

      rerender({ endpoint: '/api/v1/test2' });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/v1/test2', expect.any(Object));
      });
    });
  });
});
