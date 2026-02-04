import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSafetyEvents, safetyKeys } from './useSafetyQueries';
import api from '../../lib/api';

// Mock the api module
vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Create a wrapper with QueryClientProvider for testing
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useSafetyQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('safetyKeys', () => {
    it('should generate correct query keys', () => {
      expect(safetyKeys.all).toEqual(['safety']);
      expect(safetyKeys.events()).toEqual(['safety', 'events']);
    });
  });

  describe('useSafetyEvents', () => {
    it('should fetch safety events successfully', async () => {
      const mockEvents = {
        count: 3,
        results: [
          {
            id: 1,
            event_type: 'squawk_7700',
            icao_hex: 'ABC123',
            callsign: 'UAL123',
            severity: 'high',
            description: 'Emergency squawk detected',
            timestamp: '2024-01-01T12:00:00Z',
            acknowledged: false,
          },
          {
            id: 2,
            event_type: 'rapid_descent',
            icao_hex: 'DEF456',
            callsign: 'DAL456',
            severity: 'medium',
            description: 'Rapid altitude change detected',
            timestamp: '2024-01-01T11:30:00Z',
            acknowledged: true,
          },
          {
            id: 3,
            event_type: 'squawk_7600',
            icao_hex: 'GHI789',
            callsign: 'AAL789',
            severity: 'high',
            description: 'Radio failure squawk detected',
            timestamp: '2024-01-01T11:00:00Z',
            acknowledged: false,
          },
        ],
      };

      api.get.mockResolvedValue(mockEvents);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockEvents);
      expect(api.get).toHaveBeenCalledWith('/safety/events/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch safety events');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useSafetyEvents({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should return empty events on empty response', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.count).toBe(0);
      expect(result.current.data.results).toEqual([]);
    });

    it('should handle different event types', async () => {
      const mockEvents = {
        count: 5,
        results: [
          { id: 1, event_type: 'squawk_7700', severity: 'high' },
          { id: 2, event_type: 'squawk_7600', severity: 'high' },
          { id: 3, event_type: 'squawk_7500', severity: 'critical' },
          { id: 4, event_type: 'rapid_descent', severity: 'medium' },
          { id: 5, event_type: 'tcas_ra', severity: 'high' },
        ],
      };

      api.get.mockResolvedValue(mockEvents);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.count).toBe(5);
      expect(result.current.data.results).toHaveLength(5);
    });

    it('should have correct stale time', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Data should not be stale immediately after fetch
      expect(result.current.isStale).toBe(false);
    });

    it('should handle events with all severity levels', async () => {
      const mockEvents = {
        count: 4,
        results: [
          { id: 1, event_type: 'squawk_7500', severity: 'critical' },
          { id: 2, event_type: 'squawk_7700', severity: 'high' },
          { id: 3, event_type: 'rapid_descent', severity: 'medium' },
          { id: 4, event_type: 'altitude_deviation', severity: 'low' },
        ],
      };

      api.get.mockResolvedValue(mockEvents);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const severities = result.current.data.results.map((e) => e.severity);
      expect(severities).toContain('critical');
      expect(severities).toContain('high');
      expect(severities).toContain('medium');
      expect(severities).toContain('low');
    });

    it('should handle network timeout gracefully', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      api.get.mockRejectedValue(timeoutError);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error.name).toBe('TimeoutError');
    });

    it('should handle 404 error', async () => {
      const notFoundError = new Error('Not found');
      notFoundError.status = 404;
      api.get.mockRejectedValue(notFoundError);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error.status).toBe(404);
    });

    it('should handle 500 error', async () => {
      const serverError = new Error('Internal server error');
      serverError.status = 500;
      api.get.mockRejectedValue(serverError);

      const { result } = renderHook(() => useSafetyEvents(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error.status).toBe(500);
    });
  });
});
