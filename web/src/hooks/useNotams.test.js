import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNotams, NOTAM_TYPE_CONFIG } from './useNotams';

describe('useNotams', () => {
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

  describe('NOTAM_TYPE_CONFIG', () => {
    it('should export NOTAM type configuration', () => {
      expect(NOTAM_TYPE_CONFIG).toBeDefined();
      expect(NOTAM_TYPE_CONFIG.D).toBeDefined();
      expect(NOTAM_TYPE_CONFIG.FDC).toBeDefined();
      expect(NOTAM_TYPE_CONFIG.TFR).toBeDefined();
      expect(NOTAM_TYPE_CONFIG.GPS).toBeDefined();
      expect(NOTAM_TYPE_CONFIG.MIL).toBeDefined();
    });

    it('should have required fields for each type', () => {
      Object.entries(NOTAM_TYPE_CONFIG).forEach(([, config]) => {
        expect(config.color).toBeDefined();
        expect(config.icon).toBeDefined();
        expect(config.label).toBeDefined();
      });
    });
  });

  describe('initial state', () => {
    it('should initialize with empty state when not connected', () => {
      const { result } = renderHook(() => useNotams(null, false));

      expect(result.current.notams).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
      expect(result.current.unacknowledgedCount).toBe(0);
      expect(result.current.totalCount).toBe(0);
    });

    it('should load acknowledged NOTAMs from localStorage', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_notams') return '["notam-1", "notam-2"]';
        return null;
      });

      const { result } = renderHook(() => useNotams(null, false));

      expect(result.current.acknowledged.has('notam-1')).toBe(true);
      expect(result.current.acknowledged.has('notam-2')).toBe(true);
    });
  });

  describe('fetching NOTAMs', () => {
    it('should set error when socket not connected', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useNotams(null, false));

      act(() => {
        result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Socket not connected');
      });
    });

    it('should fetch NOTAMs when connected', async () => {
      const mockNotams = [
        { notam_id: 'notam-1', type: 'D', text: 'Runway closed' },
        { notam_id: 'notam-2', type: 'TFR', text: 'Temporary flight restriction' },
      ];

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      // Wait for initial fetch delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(2);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should filter out expired NOTAMs', async () => {
      const now = Date.now();
      const mockNotams = [
        { notam_id: 'notam-1', effective_end: new Date(now + 3600000).toISOString() },
        { notam_id: 'notam-2', effective_end: new Date(now - 3600000).toISOString() }, // expired
      ];

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
      expect(result.current.notams[0].notam_id).toBe('notam-1');
    });

    it('should include permanent NOTAMs regardless of date', async () => {
      const mockNotams = [
        { notam_id: 'notam-1', is_permanent: true },
      ];

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
    });

    it('should include NOTAMs without effective_end', async () => {
      const mockNotams = [
        { notam_id: 'notam-1' }, // No effective_end
      ];

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
    });

    it('should handle fetch errors', async () => {
      mockWsRequest.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });

    it('should debounce fetch requests', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      // Wait for initial fetch with delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
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

    it('should include location params when provided', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      renderHook(() =>
        useNotams(mockWsRequest, true, {
          lat: 37.5,
          lon: -122.5,
          radius: 50,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockWsRequest).toHaveBeenCalledWith(
        'notam-snapshot',
        expect.objectContaining({
          lat: 37.5,
          lon: -122.5,
          radius: 50,
        }),
        30000
      );
    });

    it('should include type filter when provided', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      renderHook(() =>
        useNotams(mockWsRequest, true, { typeFilter: 'TFR' })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockWsRequest).toHaveBeenCalledWith(
        'notam-snapshot',
        expect.objectContaining({ type: 'TFR' }),
        30000
      );
    });
  });

  describe('TFR handling', () => {
    it('should merge TFRs into NOTAMs list', async () => {
      const response = {
        notams: [{ notam_id: 'notam-1', type: 'D' }],
        tfrs: [{ id: 'tfr-1', name: 'TFR Area' }],
      };

      mockWsRequest.mockResolvedValue(response);

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(2);

      // TFR should have type set to 'TFR'
      const tfr = result.current.notams.find((n) => n.id === 'tfr-1');
      expect(tfr.type).toBe('TFR');
    });
  });

  describe('acknowledge/unacknowledge', () => {
    it('should acknowledge a NOTAM', async () => {
      const mockNotams = [{ notam_id: 'notam-1', type: 'D' }];
      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
      expect(result.current.unacknowledgedCount).toBe(1);

      act(() => {
        result.current.acknowledgeNotam('notam-1');
      });

      expect(result.current.acknowledged.has('notam-1')).toBe(true);
      expect(result.current.unacknowledgedCount).toBe(0);
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'skyspy_acknowledged_notams',
        expect.stringContaining('notam-1')
      );
    });

    it('should unacknowledge a NOTAM', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_notams') return '["notam-1"]';
        return null;
      });

      const { result } = renderHook(() => useNotams(null, false));

      expect(result.current.acknowledged.has('notam-1')).toBe(true);

      act(() => {
        result.current.unacknowledgeNotam('notam-1');
      });

      expect(result.current.acknowledged.has('notam-1')).toBe(false);
    });

    it('should clear all acknowledged', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_notams') return '["notam-1", "notam-2"]';
        return null;
      });

      const { result } = renderHook(() => useNotams(null, false));

      act(() => {
        result.current.clearAcknowledged();
      });

      expect(result.current.acknowledged.size).toBe(0);
    });

    it('should check if NOTAM is acknowledged', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'skyspy_acknowledged_notams') return '["notam-1"]';
        return null;
      });

      const { result } = renderHook(() => useNotams(null, false));

      expect(result.current.isAcknowledged('notam-1')).toBe(true);
      expect(result.current.isAcknowledged('notam-2')).toBe(false);
    });
  });

  describe('NOTAMs grouping', () => {
    it('should group NOTAMs by type', async () => {
      const mockNotams = [
        { notam_id: 'notam-1', type: 'D' },
        { notam_id: 'notam-2', type: 'D' },
        { notam_id: 'notam-3', type: 'FDC' },
        { notam_id: 'notam-4', type: 'GPS' },
      ];

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(4);
      expect(result.current.notamsByType.D).toHaveLength(2);
      expect(result.current.notamsByType.FDC).toHaveLength(1);
      expect(result.current.notamsByType.GPS).toHaveLength(1);
    });

    it('should use D as default type', async () => {
      const mockNotams = [{ notam_id: 'notam-1' }]; // No type field

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
      expect(result.current.notamsByType.D).toHaveLength(1);
    });
  });

  describe('type filtering', () => {
    it('should filter NOTAMs by type', async () => {
      const mockNotams = [
        { notam_id: 'notam-1', type: 'D' },
        { notam_id: 'notam-2', type: 'TFR' },
        { notam_id: 'notam-3', type: 'D' },
      ];

      mockWsRequest.mockResolvedValue({ notams: mockNotams });

      const { result } = renderHook(() =>
        useNotams(mockWsRequest, true, { typeFilter: 'TFR' })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
      expect(result.current.notams[0].type).toBe('TFR');
    });
  });

  describe('auto-refresh', () => {
    it('should auto-refresh at specified interval', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      renderHook(() =>
        useNotams(mockWsRequest, true, { refreshInterval: 60000 })
      );

      // Initial fetch with delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      // Advance past debounce time, then to refresh interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000); // Past debounce
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000); // Refresh interval
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(2);
    });

    it('should use default refresh interval of 5 minutes', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      renderHook(() => useNotams(mockWsRequest, true));

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      // Wait past debounce, then to 5 minute interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300000); // 5 minutes
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(2);
    });

    it('should not refresh when interval is 0 or falsy', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      renderHook(() =>
        useNotams(mockWsRequest, true, { refreshInterval: 0 })
      );

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockWsRequest).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600000); // Long wait
      });

      // Should still only be 1 call (no auto-refresh)
      expect(mockWsRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('response format handling', () => {
    it('should handle array response', async () => {
      mockWsRequest.mockResolvedValue([{ notam_id: 'notam-1', type: 'D' }]);

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
    });

    it('should handle response.data format', async () => {
      mockWsRequest.mockResolvedValue({
        data: [{ notam_id: 'notam-1', type: 'D' }],
      });

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.notams).toHaveLength(1);
    });

    it('should handle empty response', async () => {
      mockWsRequest.mockResolvedValue({});

      const { result } = renderHook(() => useNotams(mockWsRequest, true));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.notams).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should cleanup on unmount', async () => {
      mockWsRequest.mockResolvedValue({ notams: [] });

      const { unmount } = renderHook(() =>
        useNotams(mockWsRequest, true, { refreshInterval: 10000 })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      unmount();

      // Should not throw or cause issues after unmount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
    });
  });
});
