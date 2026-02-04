import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAircraft,
  useAircraftDetail,
  useAircraftHistory,
  aircraftKeys,
} from './useAircraftQueries';
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

describe('useAircraftQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('aircraftKeys', () => {
    it('should generate correct query keys', () => {
      expect(aircraftKeys.all).toEqual(['aircraft']);
      expect(aircraftKeys.lists()).toEqual(['aircraft', 'list']);
      expect(aircraftKeys.list({ type: 'military' })).toEqual([
        'aircraft',
        'list',
        { type: 'military' },
      ]);
      expect(aircraftKeys.details()).toEqual(['aircraft', 'detail']);
      expect(aircraftKeys.detail('ABC123')).toEqual(['aircraft', 'detail', 'ABC123']);
      expect(aircraftKeys.history('ABC123')).toEqual(['aircraft', 'history', 'ABC123']);
    });
  });

  describe('useAircraft', () => {
    it('should fetch aircraft list successfully', async () => {
      const mockAircraft = {
        count: 3,
        results: [
          {
            hex: 'ABC123',
            callsign: 'UAL123',
            altitude: 35000,
            speed: 450,
            lat: 40.7128,
            lon: -74.006,
          },
          {
            hex: 'DEF456',
            callsign: 'DAL456',
            altitude: 32000,
            speed: 420,
            lat: 41.8781,
            lon: -87.6298,
          },
          {
            hex: 'GHI789',
            callsign: 'AAL789',
            altitude: 28000,
            speed: 380,
            lat: 34.0522,
            lon: -118.2437,
          },
        ],
      };

      api.get.mockResolvedValue(mockAircraft);

      const { result } = renderHook(() => useAircraft(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockAircraft);
      expect(api.get).toHaveBeenCalledWith('/aircraft/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch aircraft');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAircraft(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAircraft({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should return empty list on empty response', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAircraft(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.count).toBe(0);
      expect(result.current.data.results).toEqual([]);
    });
  });

  describe('useAircraftDetail', () => {
    it('should fetch aircraft detail successfully', async () => {
      const mockDetail = {
        hex: 'ABC123',
        callsign: 'UAL123',
        altitude: 35000,
        speed: 450,
        track: 180,
        lat: 40.7128,
        lon: -74.006,
        registration: 'N12345',
        aircraft_type: 'B738',
        operator: 'United Airlines',
        origin: 'JFK',
        destination: 'LAX',
      };

      api.get.mockResolvedValue(mockDetail);

      const { result } = renderHook(() => useAircraftDetail('ABC123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockDetail);
      expect(api.get).toHaveBeenCalledWith('/aircraft/ABC123/');
    });

    it('should not fetch when hex is not provided', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(() => useAircraftDetail(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should not fetch when hex is empty string', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(() => useAircraftDetail(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Aircraft not found');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAircraftDetail('ABC123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should refetch when hex changes', async () => {
      const mockDetail1 = { hex: 'ABC123', callsign: 'UAL123' };
      const mockDetail2 = { hex: 'DEF456', callsign: 'DAL456' };

      api.get.mockResolvedValueOnce(mockDetail1).mockResolvedValueOnce(mockDetail2);

      const { result, rerender } = renderHook(({ hex }) => useAircraftDetail(hex), {
        wrapper: createWrapper(),
        initialProps: { hex: 'ABC123' },
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockDetail1);

      rerender({ hex: 'DEF456' });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail2);
      });

      expect(api.get).toHaveBeenCalledTimes(2);
      expect(api.get).toHaveBeenCalledWith('/aircraft/ABC123/');
      expect(api.get).toHaveBeenCalledWith('/aircraft/DEF456/');
    });
  });

  describe('useAircraftHistory', () => {
    it('should fetch aircraft history successfully', async () => {
      const mockHistory = {
        count: 5,
        results: [
          {
            id: 1,
            timestamp: '2024-01-01T12:00:00Z',
            lat: 40.7128,
            lon: -74.006,
            altitude: 35000,
          },
          {
            id: 2,
            timestamp: '2024-01-01T12:01:00Z',
            lat: 40.72,
            lon: -73.99,
            altitude: 35100,
          },
        ],
      };

      api.get.mockResolvedValue(mockHistory);

      const { result } = renderHook(() => useAircraftHistory('ABC123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockHistory);
      expect(api.get).toHaveBeenCalledWith('/aircraft/ABC123/history/');
    });

    it('should not fetch when hex is not provided', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(() => useAircraftHistory(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should not fetch when hex is undefined', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(() => useAircraftHistory(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch history');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAircraftHistory('ABC123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should return empty history array', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAircraftHistory('ABC123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.count).toBe(0);
      expect(result.current.data.results).toEqual([]);
    });
  });
});
