import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHistoryFlights, historyKeys } from './useHistoryQueries';
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
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryWrapper';
  return Wrapper;
}

describe('useHistoryQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('historyKeys', () => {
    it('should generate correct query keys', () => {
      expect(historyKeys.all).toEqual(['history']);
      expect(historyKeys.flights()).toEqual(['history', 'flights']);
      expect(historyKeys.flight({ hours: 24 })).toEqual(['history', 'flights', { hours: 24 }]);
      expect(historyKeys.flight({ page: 1, limit: 10 })).toEqual([
        'history',
        'flights',
        { page: 1, limit: 10 },
      ]);
    });
  });

  describe('useHistoryFlights', () => {
    it('should fetch flight history successfully', async () => {
      const mockFlights = {
        count: 150,
        next: '/api/v1/history/flights/?page=2',
        previous: null,
        results: [
          {
            id: 1,
            icao_hex: 'ABC123',
            callsign: 'UAL123',
            first_seen: '2024-01-01T10:00:00Z',
            last_seen: '2024-01-01T11:30:00Z',
            positions_count: 45,
          },
          {
            id: 2,
            icao_hex: 'DEF456',
            callsign: 'DAL456',
            first_seen: '2024-01-01T09:00:00Z',
            last_seen: '2024-01-01T10:45:00Z',
            positions_count: 32,
          },
        ],
      };

      api.get.mockResolvedValue(mockFlights);

      const { result } = renderHook(() => useHistoryFlights(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockFlights);
      expect(api.get).toHaveBeenCalledWith('/history/flights/', { params: {} });
    });

    it('should fetch with parameters', async () => {
      const mockFlights = { count: 10, results: [] };
      api.get.mockResolvedValue(mockFlights);

      const params = { hours: 12, limit: 50 };

      const { result } = renderHook(() => useHistoryFlights(params), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.get).toHaveBeenCalledWith('/history/flights/', { params });
    });

    it('should handle pagination parameters', async () => {
      const mockFlights = { count: 100, results: [], next: null, previous: null };
      api.get.mockResolvedValue(mockFlights);

      const params = { page: 2, limit: 25 };

      const { result } = renderHook(() => useHistoryFlights(params), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.get).toHaveBeenCalledWith('/history/flights/', { params });
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch flight history');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useHistoryFlights(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useHistoryFlights({}, { enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should filter by ICAO hex', async () => {
      const mockFlights = {
        count: 5,
        results: [
          { id: 1, icao_hex: 'ABC123', callsign: 'UAL123' },
          { id: 2, icao_hex: 'ABC123', callsign: 'UAL456' },
        ],
      };
      api.get.mockResolvedValue(mockFlights);

      const params = { icao: 'ABC123' };

      const { result } = renderHook(() => useHistoryFlights(params), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.get).toHaveBeenCalledWith('/history/flights/', { params });
      expect(result.current.data.results).toHaveLength(2);
    });

    it('should filter by callsign', async () => {
      const mockFlights = {
        count: 3,
        results: [{ id: 1, icao_hex: 'ABC123', callsign: 'UAL123' }],
      };
      api.get.mockResolvedValue(mockFlights);

      const params = { callsign: 'UAL123' };

      const { result } = renderHook(() => useHistoryFlights(params), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.get).toHaveBeenCalledWith('/history/flights/', { params });
    });

    it('should filter by military_only', async () => {
      const mockFlights = {
        count: 2,
        results: [{ id: 1, icao_hex: 'AE1234', callsign: 'EVAC01', is_military: true }],
      };
      api.get.mockResolvedValue(mockFlights);

      const params = { military_only: true };

      const { result } = renderHook(() => useHistoryFlights(params), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.get).toHaveBeenCalledWith('/history/flights/', { params });
    });

    it('should return empty results', async () => {
      api.get.mockResolvedValue({ count: 0, results: [], next: null, previous: null });

      const { result } = renderHook(() => useHistoryFlights(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.count).toBe(0);
      expect(result.current.data.results).toEqual([]);
    });

    it('should use placeholderData to keep previous data while refetching', async () => {
      const initialData = { count: 5, results: [{ id: 1 }] };
      const newData = { count: 10, results: [{ id: 1 }, { id: 2 }] };

      api.get.mockResolvedValueOnce(initialData).mockResolvedValueOnce(newData);

      const { result, rerender } = renderHook(({ params }) => useHistoryFlights(params), {
        wrapper: createWrapper(),
        initialProps: { params: { page: 1 } },
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(initialData);

      // Change params to trigger refetch
      rerender({ params: { page: 2 } });

      // Wait for the new data to load
      await waitFor(() => {
        expect(result.current.data).toEqual(newData);
      });

      // Verify both API calls were made
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('should refetch when params change', async () => {
      const data1 = { count: 5, results: [{ id: 1 }] };
      const data2 = { count: 10, results: [{ id: 2 }] };

      api.get.mockResolvedValueOnce(data1).mockResolvedValueOnce(data2);

      const { result, rerender } = renderHook(({ params }) => useHistoryFlights(params), {
        wrapper: createWrapper(),
        initialProps: { params: { hours: 24 } },
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.get).toHaveBeenCalledWith('/history/flights/', {
        params: { hours: 24 },
      });

      rerender({ params: { hours: 48 } });

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/history/flights/', {
          params: { hours: 48 },
        });
      });

      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });
});
