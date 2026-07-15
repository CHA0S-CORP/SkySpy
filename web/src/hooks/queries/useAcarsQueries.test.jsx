import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAcarsMessages, useAcarsStats, acarsKeys } from './useAcarsQueries';
import api from '../../lib/api';

// Mock the api module
vi.mock('../../lib/api', () => ({
  default: {
    getAcarsMessages: vi.fn(),
    getAcarsStats: vi.fn(),
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

describe('useAcarsQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('acarsKeys', () => {
    it('should generate correct query keys', () => {
      expect(acarsKeys.all).toEqual(['acars']);
      expect(acarsKeys.messages()).toEqual(['acars', 'messages']);
      expect(acarsKeys.stats()).toEqual(['acars', 'stats']);
    });
  });

  describe('useAcarsMessages', () => {
    it('should fetch ACARS messages successfully', async () => {
      const mockMessages = {
        count: 2,
        results: [
          {
            id: 1,
            icao_hex: 'ABC123',
            callsign: 'UAL123',
            message_text: 'Test message 1',
            label: 'H1',
            timestamp: '2024-01-01T12:00:00Z',
          },
          {
            id: 2,
            icao_hex: 'DEF456',
            callsign: 'DAL456',
            message_text: 'Test message 2',
            label: 'SA',
            timestamp: '2024-01-01T12:05:00Z',
          },
        ],
      };

      api.getAcarsMessages.mockResolvedValue(mockMessages);

      const { result } = renderHook(() => useAcarsMessages(), {
        wrapper: createWrapper(),
      });

      // Initially should be loading
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockMessages);
      expect(api.getAcarsMessages).toHaveBeenCalledTimes(1);
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch ACARS messages');
      api.getAcarsMessages.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAcarsMessages(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.getAcarsMessages.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAcarsMessages({ enabled: false }), {
        wrapper: createWrapper(),
      });

      // Should not fetch when disabled
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.getAcarsMessages).not.toHaveBeenCalled();
    });

    it('should have correct stale time', async () => {
      api.getAcarsMessages.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAcarsMessages(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Data should not be stale immediately after fetch
      expect(result.current.isStale).toBe(false);
    });
  });

  describe('useAcarsStats', () => {
    it('should fetch ACARS stats successfully', async () => {
      const mockStats = {
        total_messages: 150,
        messages_today: 25,
        unique_aircraft: 10,
        by_label: {
          H1: 50,
          SA: 30,
          B6: 70,
        },
      };

      api.getAcarsStats.mockResolvedValue(mockStats);

      const { result } = renderHook(() => useAcarsStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStats);
      expect(api.getAcarsStats).toHaveBeenCalledTimes(1);
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch ACARS stats');
      api.getAcarsStats.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAcarsStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.getAcarsStats.mockResolvedValue({});

      const { result } = renderHook(() => useAcarsStats({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.getAcarsStats).not.toHaveBeenCalled();
    });

    it('should return empty stats on empty response', async () => {
      api.getAcarsStats.mockResolvedValue({});

      const { result } = renderHook(() => useAcarsStats(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({});
    });
  });
});
