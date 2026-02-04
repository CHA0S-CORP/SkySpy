import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAirspaceAdvisories, HAZARD_CONFIG } from './useAirspaceAdvisories';

describe('useAirspaceAdvisories', () => {
  let mockWsRequest;
  let mockLocalStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsRequest = vi.fn();

    // Mock localStorage with fresh object each time
    mockLocalStorage = {};
    const localStorageMock = {
      getItem: vi.fn((key) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('HAZARD_CONFIG', () => {
    it('should export hazard configuration', () => {
      expect(HAZARD_CONFIG).toBeDefined();
      expect(HAZARD_CONFIG.IFR).toBeDefined();
      expect(HAZARD_CONFIG.TURB).toBeDefined();
      expect(HAZARD_CONFIG.TS).toBeDefined();
      expect(HAZARD_CONFIG.ICE).toBeDefined();
    });

    it('should have required fields for each hazard', () => {
      Object.entries(HAZARD_CONFIG).forEach(([key, config]) => {
        expect(config.color).toBeDefined();
        expect(config.icon).toBeDefined();
        expect(config.label).toBeDefined();
      });
    });
  });

  describe('initial state', () => {
    it('should initialize with empty state when not connected', () => {
      const { result } = renderHook(() => useAirspaceAdvisories(null, false));

      expect(result.current.advisories).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(result.current.unacknowledgedCount).toBe(0);
      expect(result.current.totalCount).toBe(0);
    });

    it('should load acknowledged advisories from localStorage', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_advisories') return '["adv-1", "adv-2"]';
        return null;
      });

      const { result } = renderHook(() => useAirspaceAdvisories(null, false));

      expect(result.current.acknowledged.has('adv-1')).toBe(true);
      expect(result.current.acknowledged.has('adv-2')).toBe(true);
    });
  });

  describe('fetching advisories', () => {
    it('should set error when socket not connected', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useAirspaceAdvisories(null, false));

      act(() => {
        result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Socket not connected');
      });
    });

    it('should fetch advisories when connected', async () => {
      vi.useRealTimers();

      const mockAdvisories = [
        { id: 'adv-1', hazard: 'TURB', valid_to: new Date(Date.now() + 3600000).toISOString() },
        { id: 'adv-2', hazard: 'TS', valid_to: new Date(Date.now() + 7200000).toISOString() },
      ];

      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(2);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should filter out expired advisories', async () => {
      vi.useRealTimers();

      const mockAdvisories = [
        { id: 'adv-1', hazard: 'TURB', valid_to: new Date(Date.now() + 3600000).toISOString() },
        { id: 'adv-2', hazard: 'TS', valid_to: new Date(Date.now() - 3600000).toISOString() }, // expired
      ];

      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(1);
        expect(result.current.advisories[0].id).toBe('adv-1');
      });
    });

    it('should include advisories without valid_to date', async () => {
      vi.useRealTimers();

      const mockAdvisories = [
        { id: 'adv-1', hazard: 'TURB' }, // No valid_to means it's always valid
      ];

      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(1);
      });
    });

    it('should handle fetch errors', async () => {
      vi.useRealTimers();

      mockWsRequest.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });

      expect(result.current.loading).toBe(false);
    });

    it('should apply hazard filter when provided', async () => {
      vi.useRealTimers();

      const mockAdvisories = [
        { id: 'adv-1', hazard: 'TURB' },
        { id: 'adv-2', hazard: 'TS' },
      ];

      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() =>
        useAirspaceAdvisories(mockWsRequest, true, { hazardFilter: 'TURB' })
      );

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(1);
        expect(result.current.advisories[0].hazard).toBe('TURB');
      });
    });

    it('should debounce fetch requests', async () => {
      mockWsRequest.mockResolvedValue({ advisories: [] });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      // First fetch happens with delay on mount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Try to fetch multiple times rapidly
      act(() => {
        result.current.refresh();
        result.current.refresh();
        result.current.refresh();
      });

      // Only 1 fetch should have occurred (initial after delay)
      expect(mockWsRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('acknowledge/unacknowledge', () => {
    it('should acknowledge an advisory', async () => {
      vi.useRealTimers();

      const mockAdvisories = [{ id: 'adv-1', hazard: 'TURB' }];
      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(1);
      });

      expect(result.current.unacknowledgedCount).toBe(1);

      act(() => {
        result.current.acknowledgeAdvisory('adv-1');
      });

      expect(result.current.acknowledged.has('adv-1')).toBe(true);
      expect(result.current.unacknowledgedCount).toBe(0);
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'skyspy_acknowledged_advisories',
        expect.stringContaining('adv-1')
      );
    });

    it('should unacknowledge an advisory', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_advisories') return '["adv-1"]';
        return null;
      });

      const { result } = renderHook(() => useAirspaceAdvisories(null, false));

      expect(result.current.acknowledged.has('adv-1')).toBe(true);

      act(() => {
        result.current.unacknowledgeAdvisory('adv-1');
      });

      expect(result.current.acknowledged.has('adv-1')).toBe(false);
    });

    it('should clear all acknowledged', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_advisories') return '["adv-1", "adv-2"]';
        return null;
      });

      const { result } = renderHook(() => useAirspaceAdvisories(null, false));

      act(() => {
        result.current.clearAcknowledged();
      });

      expect(result.current.acknowledged.size).toBe(0);
    });

    it('should check if advisory is acknowledged', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_advisories') return '["adv-1"]';
        return null;
      });

      const { result } = renderHook(() => useAirspaceAdvisories(null, false));

      expect(result.current.isAcknowledged('adv-1')).toBe(true);
      expect(result.current.isAcknowledged('adv-2')).toBe(false);
    });
  });

  describe('advisories grouping', () => {
    it('should group advisories by hazard type', async () => {
      vi.useRealTimers();

      const mockAdvisories = [
        { id: 'adv-1', hazard: 'TURB' },
        { id: 'adv-2', hazard: 'TURB' },
        { id: 'adv-3', hazard: 'TS' },
        { id: 'adv-4', hazard: 'ICE' },
      ];

      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(4);
      });

      expect(result.current.advisoriesByHazard.TURB).toHaveLength(2);
      expect(result.current.advisoriesByHazard.TS).toHaveLength(1);
      expect(result.current.advisoriesByHazard.ICE).toHaveLength(1);
    });

    it('should handle missing hazard type', async () => {
      vi.useRealTimers();

      const mockAdvisories = [{ id: 'adv-1' }]; // No hazard field

      mockWsRequest.mockResolvedValue({ advisories: mockAdvisories });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(1);
      });

      expect(result.current.advisoriesByHazard.OTHER).toHaveLength(1);
    });
  });

  describe('auto-refresh', () => {
    it('should auto-refresh at specified interval', async () => {
      mockWsRequest.mockResolvedValue({ advisories: [] });

      renderHook(() =>
        useAirspaceAdvisories(mockWsRequest, true, { refreshInterval: 10000 })
      );

      // Initial fetch with delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      // Advance past debounce time, then to refresh interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000); // Past debounce
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000); // Refresh interval
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(2);
    });

    it('should not refresh when interval is 0 or falsy', async () => {
      mockWsRequest.mockResolvedValue({ advisories: [] });

      renderHook(() =>
        useAirspaceAdvisories(mockWsRequest, true, { refreshInterval: 0 })
      );

      // Initial fetch with delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120000); // Long wait
      });

      // Should still only be 1 call (no auto-refresh)
      expect(mockWsRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup', () => {
    it('should cleanup on unmount', async () => {
      mockWsRequest.mockResolvedValue({ advisories: [] });

      const { unmount } = renderHook(() =>
        useAirspaceAdvisories(mockWsRequest, true, { refreshInterval: 10000 })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      unmount();

      // Should not throw or cause issues after unmount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
    });
  });

  describe('response format handling', () => {
    it('should handle response.data format', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        data: [{ id: 'adv-1', hazard: 'TURB' }],
      });

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.advisories).toHaveLength(1);
      });
    });

    it('should handle empty response', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({});

      const { result } = renderHook(() => useAirspaceAdvisories(mockWsRequest, true));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.advisories).toEqual([]);
    });
  });
});
