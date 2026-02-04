import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useListPreferences } from './useListPreferences';

describe('useListPreferences', () => {
  beforeEach(() => {
    // Reset localStorage mock before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should return default preferences when nothing stored', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.viewMode).toBe('table');
      expect(result.current.density).toBe('comfortable');
      expect(result.current.visibleColumns).toEqual([
        'hex',
        'flight',
        'type',
        'alt',
        'gs',
        'vr',
        'track',
        'distance_nm',
        'rssi',
        'squawk',
      ]);
    });
  });

  describe('setViewMode', () => {
    it('should update view mode to cards', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.viewMode).toBe('table');

      act(() => {
        result.current.setViewMode('cards');
      });

      expect(result.current.viewMode).toBe('cards');
    });

    it('should update view mode back to table', () => {
      const { result } = renderHook(() => useListPreferences());

      act(() => {
        result.current.setViewMode('cards');
      });

      expect(result.current.viewMode).toBe('cards');

      act(() => {
        result.current.setViewMode('table');
      });

      expect(result.current.viewMode).toBe('table');
    });

    it('should persist view mode to localStorage', async () => {
      const { result } = renderHook(() => useListPreferences());

      act(() => {
        result.current.setViewMode('cards');
      });

      // Wait for useEffect to call localStorage.setItem
      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalled();
      });

      // Find the LAST call with our key (after state update)
      const calls = localStorage.setItem.mock.calls;
      const preferencesCalls = calls.filter((call) => call[0] === 'aircraft-list-preferences');
      expect(preferencesCalls.length).toBeGreaterThan(0);
      const lastCall = preferencesCalls[preferencesCalls.length - 1];
      const parsed = JSON.parse(lastCall[1]);
      expect(parsed.viewMode).toBe('cards');
    });
  });

  describe('setDensity', () => {
    it('should update density', () => {
      const { result } = renderHook(() => useListPreferences());

      act(() => {
        result.current.setDensity('compact');
      });

      expect(result.current.density).toBe('compact');
    });

    it('should persist density to localStorage', async () => {
      const { result } = renderHook(() => useListPreferences());

      act(() => {
        result.current.setDensity('compact');
      });

      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalled();
      });

      const calls = localStorage.setItem.mock.calls;
      const preferencesCalls = calls.filter((call) => call[0] === 'aircraft-list-preferences');
      expect(preferencesCalls.length).toBeGreaterThan(0);
      const lastCall = preferencesCalls[preferencesCalls.length - 1];
      const parsed = JSON.parse(lastCall[1]);
      expect(parsed.density).toBe('compact');
    });
  });

  describe('toggleColumn', () => {
    it('should hide a visible column', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.visibleColumns).toContain('hex');

      act(() => {
        result.current.toggleColumn('hex');
      });

      expect(result.current.visibleColumns).not.toContain('hex');
    });

    it('should show a hidden column', () => {
      const { result } = renderHook(() => useListPreferences());

      // First hide the column
      act(() => {
        result.current.toggleColumn('hex');
      });

      expect(result.current.visibleColumns).not.toContain('hex');

      // Then show it again
      act(() => {
        result.current.toggleColumn('hex');
      });

      expect(result.current.visibleColumns).toContain('hex');
    });

    it('should persist column visibility to localStorage', async () => {
      const { result } = renderHook(() => useListPreferences());

      act(() => {
        result.current.toggleColumn('squawk');
      });

      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalled();
      });

      const calls = localStorage.setItem.mock.calls;
      const preferencesCalls = calls.filter((call) => call[0] === 'aircraft-list-preferences');
      expect(preferencesCalls.length).toBeGreaterThan(0);
      const lastCall = preferencesCalls[preferencesCalls.length - 1];
      const parsed = JSON.parse(lastCall[1]);
      expect(parsed.visibleColumns).not.toContain('squawk');
    });
  });

  describe('setColumnPreset', () => {
    it('should apply minimal preset', () => {
      const { result } = renderHook(() => useListPreferences());

      act(() => {
        result.current.setColumnPreset('minimal');
      });

      expect(result.current.visibleColumns).toEqual(['hex', 'flight', 'alt', 'gs', 'distance_nm']);
    });

    it('should apply all preset', () => {
      const { result } = renderHook(() => useListPreferences());

      // First apply minimal
      act(() => {
        result.current.setColumnPreset('minimal');
      });

      expect(result.current.visibleColumns.length).toBe(5);

      // Then apply all
      act(() => {
        result.current.setColumnPreset('all');
      });

      expect(result.current.visibleColumns.length).toBe(10);
    });

    it('should apply default preset', () => {
      const { result } = renderHook(() => useListPreferences());

      // First change to minimal
      act(() => {
        result.current.setColumnPreset('minimal');
      });

      expect(result.current.visibleColumns.length).toBe(5);

      // Then restore default
      act(() => {
        result.current.setColumnPreset('default');
      });

      expect(result.current.visibleColumns).toEqual([
        'hex',
        'flight',
        'type',
        'alt',
        'gs',
        'vr',
        'track',
        'distance_nm',
        'rssi',
        'squawk',
      ]);
    });

    it('should ignore invalid preset', () => {
      const { result } = renderHook(() => useListPreferences());
      const originalColumns = [...result.current.visibleColumns];

      act(() => {
        result.current.setColumnPreset('nonexistent');
      });

      expect(result.current.visibleColumns).toEqual(originalColumns);
    });
  });

  describe('isColumnVisible', () => {
    it('should return true for visible columns', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.isColumnVisible('hex')).toBe(true);
      expect(result.current.isColumnVisible('flight')).toBe(true);
    });

    it('should return false for hidden columns', () => {
      const { result } = renderHook(() => useListPreferences());

      // Hide a column
      act(() => {
        result.current.toggleColumn('hex');
      });

      expect(result.current.isColumnVisible('hex')).toBe(false);
      expect(result.current.isColumnVisible('flight')).toBe(true);
    });

    it('should update when columns change', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.isColumnVisible('hex')).toBe(true);

      act(() => {
        result.current.toggleColumn('hex');
      });

      expect(result.current.isColumnVisible('hex')).toBe(false);
    });
  });

  describe('resetToDefaults', () => {
    it('should reset all preferences to defaults', () => {
      const { result } = renderHook(() => useListPreferences());

      // Make some changes
      act(() => {
        result.current.setViewMode('cards');
        result.current.setDensity('compact');
        result.current.setColumnPreset('minimal');
      });

      expect(result.current.viewMode).toBe('cards');
      expect(result.current.density).toBe('compact');
      expect(result.current.visibleColumns.length).toBe(5);

      // Reset
      act(() => {
        result.current.resetToDefaults();
      });

      expect(result.current.viewMode).toBe('table');
      expect(result.current.density).toBe('comfortable');
      expect(result.current.visibleColumns).toEqual([
        'hex',
        'flight',
        'type',
        'alt',
        'gs',
        'vr',
        'track',
        'distance_nm',
        'rssi',
        'squawk',
      ]);
    });
  });

  describe('columns', () => {
    it('should return all column definitions', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.columns).toBeInstanceOf(Array);
      expect(result.current.columns.length).toBe(10);

      const hexColumn = result.current.columns.find((c) => c.id === 'hex');
      expect(hexColumn).toBeDefined();
      expect(hexColumn.label).toBe('ICAO');
      expect(hexColumn.visible).toBe(true);
      expect(hexColumn.sortable).toBe(true);
    });
  });

  describe('presets', () => {
    it('should return available presets', () => {
      const { result } = renderHook(() => useListPreferences());

      expect(result.current.presets).toBeDefined();
      expect(result.current.presets.default).toBeDefined();
      expect(result.current.presets.minimal).toBeDefined();
      expect(result.current.presets.all).toBeDefined();
    });
  });
});
