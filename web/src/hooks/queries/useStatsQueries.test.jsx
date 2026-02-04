import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useStats,
  useSessionStats,
  useRecordStats,
  statsKeys,
} from './useStatsQueries';
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

describe('useStatsQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('statsKeys', () => {
    it('should generate correct query keys', () => {
      expect(statsKeys.all).toEqual(['stats']);
      expect(statsKeys.current()).toEqual(['stats', 'current']);
      expect(statsKeys.session()).toEqual(['stats', 'session']);
      expect(statsKeys.records()).toEqual(['stats', 'records']);
    });
  });

  describe('useStats', () => {
    it('should fetch current stats successfully', async () => {
      const mockStats = {
        aircraft_count: 45,
        positions_per_second: 120.5,
        unique_aircraft_24h: 350,
        messages_received: 15000,
        coverage_radius_nm: 250,
        last_update: '2024-01-01T12:00:00Z',
      };

      api.get.mockResolvedValue(mockStats);

      const { result } = renderHook(() => useStats(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStats);
      expect(api.get).toHaveBeenCalledWith('/stats/current/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch stats');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(() => useStats({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should have correct stale time', async () => {
      api.get.mockResolvedValue({ aircraft_count: 10 });

      const { result } = renderHook(() => useStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Data should not be stale immediately after fetch
      expect(result.current.isStale).toBe(false);
    });

    it('should return zero counts on empty response', async () => {
      api.get.mockResolvedValue({
        aircraft_count: 0,
        positions_per_second: 0,
        unique_aircraft_24h: 0,
      });

      const { result } = renderHook(() => useStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.aircraft_count).toBe(0);
    });
  });

  describe('useSessionStats', () => {
    it('should fetch session stats successfully', async () => {
      const mockSessionStats = {
        session_id: 'sess_12345',
        started_at: '2024-01-01T08:00:00Z',
        duration_seconds: 14400,
        aircraft_tracked: 250,
        positions_recorded: 45000,
        alerts_triggered: 5,
        peak_aircraft: 85,
        peak_time: '2024-01-01T10:30:00Z',
      };

      api.get.mockResolvedValue(mockSessionStats);

      const { result } = renderHook(() => useSessionStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockSessionStats);
      expect(api.get).toHaveBeenCalledWith('/stats/session/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch session stats');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useSessionStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(
        () => useSessionStats({ enabled: false }),
        { wrapper: createWrapper() }
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should handle no active session', async () => {
      api.get.mockResolvedValue({
        session_id: null,
        started_at: null,
        message: 'No active session',
      });

      const { result } = renderHook(() => useSessionStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.session_id).toBeNull();
    });
  });

  describe('useRecordStats', () => {
    it('should fetch record stats successfully', async () => {
      const mockRecords = {
        most_aircraft: {
          count: 125,
          timestamp: '2024-01-01T14:30:00Z',
        },
        longest_track: {
          icao_hex: 'ABC123',
          callsign: 'UAL123',
          duration_minutes: 240,
          distance_nm: 1500,
        },
        highest_altitude: {
          icao_hex: 'DEF456',
          callsign: 'NASA01',
          altitude_ft: 85000,
          timestamp: '2024-01-01T09:00:00Z',
        },
        fastest_aircraft: {
          icao_hex: 'GHI789',
          callsign: 'SPAR19',
          speed_knots: 650,
          timestamp: '2024-01-01T11:00:00Z',
        },
        most_distant: {
          icao_hex: 'JKL012',
          callsign: 'QFA7',
          distance_nm: 320,
          timestamp: '2024-01-01T16:00:00Z',
        },
      };

      api.get.mockResolvedValue(mockRecords);

      const { result } = renderHook(() => useRecordStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockRecords);
      expect(api.get).toHaveBeenCalledWith('/stats/records/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch record stats');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useRecordStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({});

      const { result } = renderHook(() => useRecordStats({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should return empty records when no data', async () => {
      api.get.mockResolvedValue({
        most_aircraft: null,
        longest_track: null,
        highest_altitude: null,
        fastest_aircraft: null,
        most_distant: null,
      });

      const { result } = renderHook(() => useRecordStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.most_aircraft).toBeNull();
      expect(result.current.data.longest_track).toBeNull();
    });

    it('should handle partial record data', async () => {
      api.get.mockResolvedValue({
        most_aircraft: { count: 50 },
        longest_track: null,
        highest_altitude: { altitude_ft: 45000 },
      });

      const { result } = renderHook(() => useRecordStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data.most_aircraft.count).toBe(50);
      expect(result.current.data.longest_track).toBeNull();
      expect(result.current.data.highest_altitude.altitude_ft).toBe(45000);
    });
  });

  describe('multiple hooks integration', () => {
    it('should fetch all stats types independently', async () => {
      const mockCurrent = { aircraft_count: 45 };
      const mockSession = { session_id: 'sess_123' };
      const mockRecords = { most_aircraft: { count: 100 } };

      api.get
        .mockResolvedValueOnce(mockCurrent)
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce(mockRecords);

      const wrapper = createWrapper();

      const { result: currentResult } = renderHook(() => useStats(), {
        wrapper,
      });
      const { result: sessionResult } = renderHook(() => useSessionStats(), {
        wrapper,
      });
      const { result: recordsResult } = renderHook(() => useRecordStats(), {
        wrapper,
      });

      await waitFor(() => {
        expect(currentResult.current.isSuccess).toBe(true);
        expect(sessionResult.current.isSuccess).toBe(true);
        expect(recordsResult.current.isSuccess).toBe(true);
      });

      expect(currentResult.current.data).toEqual(mockCurrent);
      expect(sessionResult.current.data).toEqual(mockSession);
      expect(recordsResult.current.data).toEqual(mockRecords);
    });
  });
});
