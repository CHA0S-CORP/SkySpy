import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  useAlertHistory,
  alertKeys,
} from './useAlertQueries';
import api from '../../lib/api';

// Mock the api module
vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
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
      mutations: {
        retry: false,
      },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useAlertQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('alertKeys', () => {
    it('should generate correct query keys', () => {
      expect(alertKeys.all).toEqual(['alerts']);
      expect(alertKeys.rules()).toEqual(['alerts', 'rules']);
      expect(alertKeys.history()).toEqual(['alerts', 'history']);
    });
  });

  describe('useAlertRules', () => {
    it('should fetch alert rules successfully', async () => {
      const mockRules = {
        count: 2,
        results: [
          {
            id: 1,
            name: 'Military Alert',
            rule_type: 'military',
            enabled: true,
            priority: 'high',
            conditions: { military: true },
          },
          {
            id: 2,
            name: 'Low Altitude Alert',
            rule_type: 'altitude',
            enabled: true,
            priority: 'medium',
            conditions: { altitude_below: 5000 },
          },
        ],
      };

      api.get.mockResolvedValue(mockRules);

      const { result } = renderHook(() => useAlertRules(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockRules);
      expect(api.get).toHaveBeenCalledWith('/alerts/rules/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch alert rules');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAlertRules(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAlertRules({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe('useCreateAlertRule', () => {
    it('should create alert rule successfully', async () => {
      const newRule = {
        name: 'New Alert',
        rule_type: 'callsign',
        enabled: true,
        priority: 'low',
        conditions: { callsign_pattern: 'UAL*' },
      };

      const createdRule = { id: 3, ...newRule };

      api.post.mockResolvedValue(createdRule);

      const { result } = renderHook(() => useCreateAlertRule(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate(newRule);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(createdRule);
      expect(api.post).toHaveBeenCalledWith('/alerts/rules/', newRule);
    });

    it('should handle create error', async () => {
      const mockError = new Error('Failed to create alert rule');
      api.post.mockRejectedValue(mockError);

      const { result } = renderHook(() => useCreateAlertRule(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({ name: 'Test' });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should invalidate rules query on success', async () => {
      const mockRules = { count: 1, results: [{ id: 1, name: 'Existing' }] };
      const newRule = { name: 'New Alert', rule_type: 'military' };
      const createdRule = { id: 2, ...newRule };

      api.get.mockResolvedValue(mockRules);
      api.post.mockResolvedValue(createdRule);

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false },
        },
      });

      // Spy on invalidateQueries
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      // First fetch rules
      const { result: rulesResult } = renderHook(() => useAlertRules(), {
        wrapper,
      });

      await waitFor(() => {
        expect(rulesResult.current.isSuccess).toBe(true);
      });

      // Then create a new rule
      const { result: createResult } = renderHook(() => useCreateAlertRule(), {
        wrapper,
      });

      await act(async () => {
        createResult.current.mutate(newRule);
      });

      await waitFor(() => {
        expect(createResult.current.isSuccess).toBe(true);
      });

      // Check that invalidateQueries was called with the rules query key
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: alertKeys.rules(),
      });
    });
  });

  describe('useUpdateAlertRule', () => {
    it('should update alert rule successfully', async () => {
      const updateData = { enabled: false };
      const updatedRule = {
        id: 1,
        name: 'Military Alert',
        enabled: false,
      };

      api.patch.mockResolvedValue(updatedRule);

      const { result } = renderHook(() => useUpdateAlertRule(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({ id: 1, data: updateData });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(updatedRule);
      expect(api.patch).toHaveBeenCalledWith('/alerts/rules/1/', updateData);
    });

    it('should handle update error', async () => {
      const mockError = new Error('Failed to update alert rule');
      api.patch.mockRejectedValue(mockError);

      const { result } = renderHook(() => useUpdateAlertRule(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({ id: 1, data: { enabled: false } });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });
  });

  describe('useDeleteAlertRule', () => {
    it('should delete alert rule successfully', async () => {
      api.delete.mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteAlertRule(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate(1);
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(api.delete).toHaveBeenCalledWith('/alerts/rules/1/');
    });

    it('should handle delete error', async () => {
      const mockError = new Error('Failed to delete alert rule');
      api.delete.mockRejectedValue(mockError);

      const { result } = renderHook(() => useDeleteAlertRule(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate(1);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });
  });

  describe('useAlertHistory', () => {
    it('should fetch alert history successfully', async () => {
      const mockHistory = {
        count: 3,
        results: [
          {
            id: 1,
            rule_name: 'Military Alert',
            icao_hex: 'ABC123',
            callsign: 'EVAC01',
            triggered_at: '2024-01-01T12:00:00Z',
            acknowledged: false,
          },
          {
            id: 2,
            rule_name: 'Low Altitude Alert',
            icao_hex: 'DEF456',
            callsign: 'N12345',
            triggered_at: '2024-01-01T11:30:00Z',
            acknowledged: true,
          },
        ],
      };

      api.get.mockResolvedValue(mockHistory);

      const { result } = renderHook(() => useAlertHistory(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockHistory);
      expect(api.get).toHaveBeenCalledWith('/alerts/history/');
    });

    it('should handle fetch error', async () => {
      const mockError = new Error('Failed to fetch alert history');
      api.get.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAlertHistory(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBe(mockError);
    });

    it('should accept custom options', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAlertHistory({ enabled: false }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(api.get).not.toHaveBeenCalled();
    });

    it('should return empty history on empty response', async () => {
      api.get.mockResolvedValue({ count: 0, results: [] });

      const { result } = renderHook(() => useAlertHistory(), {
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
