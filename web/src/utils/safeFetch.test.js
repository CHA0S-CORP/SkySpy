import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import safeFetchJson, { safeParseJson } from './safeFetch';

// Mock fetch
const fetchMock = vi.fn();

beforeEach(() => {
  global.fetch = fetchMock;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('safeFetchJson', () => {
  describe('successful requests', () => {
    it('should return data for successful JSON response', async () => {
      const mockData = { message: 'success', id: 123 };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => mockData,
      });

      const promise = safeFetchJson('https://api.example.com/data');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockData);
      expect(result.error).toBeNull();
      expect(result.status).toBe(200);
    });

    it('should handle application/json; charset=utf-8 content type', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json; charset=utf-8']]),
        json: async () => ({ data: 'test' }),
      });

      const promise = safeFetchJson('https://api.example.com/data');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ data: 'test' });
    });

    it('should pass through fetch options', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({}),
      });

      const options = {
        method: 'POST',
        headers: { 'X-Custom': 'header' },
        body: JSON.stringify({ key: 'value' }),
      };

      const promise = safeFetchJson('https://api.example.com/data', options);
      vi.runAllTimers();
      await promise;

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          headers: { 'X-Custom': 'header' },
          body: JSON.stringify({ key: 'value' }),
        })
      );
    });
  });

  describe('HTTP errors', () => {
    it('should handle 404 Not Found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Map([['content-type', 'application/json']]),
      });

      const promise = safeFetchJson('https://api.example.com/notfound');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('HTTP 404');
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    });

    it('should handle 500 Server Error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Map([['content-type', 'application/json']]),
      });

      const promise = safeFetchJson('https://api.example.com/error');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('HTTP 500');
      expect(result.status).toBe(500);
    });

    it('should handle 401 Unauthorized', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Map([['content-type', 'application/json']]),
      });

      const promise = safeFetchJson('https://api.example.com/protected');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('HTTP 401');
    });
  });

  describe('non-JSON responses', () => {
    it('should return error for HTML response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
      });

      const promise = safeFetchJson('https://api.example.com/html');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid response format (not JSON)');
      expect(result.data).toBeNull();
    });

    it('should return error for plain text response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/plain']]),
      });

      const promise = safeFetchJson('https://api.example.com/text');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid response format (not JSON)');
    });

    it('should return error for missing content-type', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
      });

      const promise = safeFetchJson('https://api.example.com/nocontent');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid response format (not JSON)');
    });
  });

  describe('network errors', () => {
    it('should handle network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network request failed'));

      const promise = safeFetchJson('https://api.example.com/data');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network request failed');
      expect(result.status).toBe(0);
    });

    it('should handle DNS resolution failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('DNS lookup failed'));

      const promise = safeFetchJson('https://nonexistent.example.com');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain('DNS');
    });
  });

  describe('timeout handling', () => {
    it('should timeout after default 30 seconds', async () => {
      // Create an AbortError that will be thrown when timeout triggers
      fetchMock.mockImplementationOnce(
        (url, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );

      const promise = safeFetchJson('https://api.example.com/slow');

      // Advance past default timeout
      await vi.advanceTimersByTimeAsync(30001);

      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Request timeout');
      expect(result.aborted).toBe(true);
    });

    it('should respect custom timeout', async () => {
      fetchMock.mockImplementationOnce(
        (url, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );

      const promise = safeFetchJson('https://api.example.com/slow', { timeout: 5000 });

      await vi.advanceTimersByTimeAsync(5001);

      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Request timeout');
    });

    it('should complete before timeout', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ success: true }),
      });

      const promise = safeFetchJson('https://api.example.com/fast', { timeout: 5000 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ success: true });
    });
  });

  describe('abort handling', () => {
    it('should return aborted flag for abort errors', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortError);

      const promise = safeFetchJson('https://api.example.com/data');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Request timeout');
      expect(result.aborted).toBe(true);
    });

    it('should respect existing signal', async () => {
      const controller = new AbortController();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({}),
      });

      const promise = safeFetchJson('https://api.example.com/data', {
        signal: controller.signal,
      });
      vi.runAllTimers();
      await promise;

      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty response body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => null,
      });

      const promise = safeFetchJson('https://api.example.com/empty');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should handle error with no message', async () => {
      fetchMock.mockRejectedValueOnce(new Error());

      const promise = safeFetchJson('https://api.example.com/data');
      vi.runAllTimers();
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });
});

describe('safeParseJson', () => {
  describe('successful parsing', () => {
    it('should parse JSON from response', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ data: 'test' }),
      };

      const result = await safeParseJson(mockResponse);

      expect(result.data).toEqual({ data: 'test' });
      expect(result.error).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should return error for non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        headers: new Map([['content-type', 'application/json']]),
      };

      const result = await safeParseJson(mockResponse);

      expect(result.data).toBeNull();
      expect(result.error).toBe('HTTP 500');
    });

    it('should return error for non-JSON content type', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/html']]),
      };

      const result = await safeParseJson(mockResponse);

      expect(result.data).toBeNull();
      expect(result.error).toBe('Invalid response format');
    });

    it('should return error for missing content type', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map(),
      };

      const result = await safeParseJson(mockResponse);

      expect(result.data).toBeNull();
      expect(result.error).toBe('Invalid response format');
    });

    it('should return error for JSON parse failure', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => {
          throw new Error('Invalid JSON');
        },
      };

      const result = await safeParseJson(mockResponse);

      expect(result.data).toBeNull();
      expect(result.error).toBe('Invalid JSON');
    });
  });
});
