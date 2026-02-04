import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Create a fresh localStorage mock for each test
const createLocalStorageMock = () => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i) => Object.keys(store)[i] ?? null),
  };
};

// We need to dynamically import the hook AFTER setting up the localStorage mock
let useAltitudeFilter;
let ALTITUDE_PRESETS;

describe('useAltitudeFilter', () => {
  let localStorageMock;

  beforeEach(async () => {
    // Set up localStorage mock FIRST
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.clearAllMocks();
    vi.resetModules();

    // Then dynamically import the module
    const module = await import('./useAltitudeFilter');
    useAltitudeFilter = module.useAltitudeFilter;
    ALTITUDE_PRESETS = module.ALTITUDE_PRESETS;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('initialization', () => {
    it('should initialize with default values when no localStorage data', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.altitudeFilter).toEqual({
        enabled: false,
        min: 0,
        max: 60000,
        preset: 'all',
        hideFiltered: false,
      });
    });

    it('should restore state from localStorage', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({
          enabled: true,
          min: 10000,
          max: 18000,
          preset: 'transition',
          hideFiltered: true,
        })
      );

      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.altitudeFilter.enabled).toBe(true);
      expect(result.current.altitudeFilter.min).toBe(10000);
      expect(result.current.altitudeFilter.max).toBe(18000);
      expect(result.current.altitudeFilter.preset).toBe('transition');
      expect(result.current.altitudeFilter.hideFiltered).toBe(true);
    });
  });

  describe('ALTITUDE_PRESETS', () => {
    it('should have all required presets', () => {
      expect(ALTITUDE_PRESETS).toHaveProperty('all');
      expect(ALTITUDE_PRESETS).toHaveProperty('low');
      expect(ALTITUDE_PRESETS).toHaveProperty('transition');
      expect(ALTITUDE_PRESETS).toHaveProperty('high');
      expect(ALTITUDE_PRESETS).toHaveProperty('upper');
      expect(ALTITUDE_PRESETS).toHaveProperty('superHigh');
      expect(ALTITUDE_PRESETS).toHaveProperty('custom');
    });

    it('should have correct altitude ranges', () => {
      expect(ALTITUDE_PRESETS.all).toEqual({ label: 'All', min: 0, max: 60000 });
      expect(ALTITUDE_PRESETS.low).toEqual({
        label: 'Low (Surface - 10,000ft)',
        min: 0,
        max: 10000,
      });
      expect(ALTITUDE_PRESETS.transition).toEqual({
        label: 'Transition (10,000 - 18,000ft)',
        min: 10000,
        max: 18000,
      });
      expect(ALTITUDE_PRESETS.high).toEqual({
        label: 'High (18,000 - 29,000ft)',
        min: 18000,
        max: 29000,
      });
      expect(ALTITUDE_PRESETS.upper).toEqual({
        label: 'Upper (29,000 - 45,000ft)',
        min: 29000,
        max: 45000,
      });
      expect(ALTITUDE_PRESETS.superHigh).toEqual({
        label: 'Super High (45,000ft+)',
        min: 45000,
        max: 60000,
      });
    });
  });

  describe('setAltitudePreset', () => {
    it('should set preset to "all" and disable filter', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      // First enable a preset
      act(() => {
        result.current.setAltitudePreset('low');
      });

      expect(result.current.altitudeFilter.enabled).toBe(true);

      // Then set to "all"
      act(() => {
        result.current.setAltitudePreset('all');
      });

      expect(result.current.altitudeFilter.enabled).toBe(false);
      expect(result.current.altitudeFilter.preset).toBe('all');
      expect(result.current.altitudeFilter.min).toBe(0);
      expect(result.current.altitudeFilter.max).toBe(60000);
    });

    it('should set preset to "low" with correct range', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('low');
      });

      expect(result.current.altitudeFilter.enabled).toBe(true);
      expect(result.current.altitudeFilter.preset).toBe('low');
      expect(result.current.altitudeFilter.min).toBe(0);
      expect(result.current.altitudeFilter.max).toBe(10000);
    });

    it('should set preset to "high" with correct range', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('high');
      });

      expect(result.current.altitudeFilter.enabled).toBe(true);
      expect(result.current.altitudeFilter.preset).toBe('high');
      expect(result.current.altitudeFilter.min).toBe(18000);
      expect(result.current.altitudeFilter.max).toBe(29000);
    });

    it('should switch to custom preset and keep current range', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      // First set a preset
      act(() => {
        result.current.setAltitudePreset('transition');
      });

      const prevMin = result.current.altitudeFilter.min;
      const prevMax = result.current.altitudeFilter.max;

      // Switch to custom
      act(() => {
        result.current.setAltitudePreset('custom');
      });

      expect(result.current.altitudeFilter.preset).toBe('custom');
      expect(result.current.altitudeFilter.min).toBe(prevMin);
      expect(result.current.altitudeFilter.max).toBe(prevMax);
    });
  });

  describe('setCustomRange', () => {
    it('should set custom min value', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setCustomRange(5000, undefined);
      });

      expect(result.current.altitudeFilter.min).toBe(5000);
      expect(result.current.altitudeFilter.preset).toBe('custom');
      expect(result.current.altitudeFilter.enabled).toBe(true);
    });

    it('should set custom max value', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setCustomRange(undefined, 25000);
      });

      expect(result.current.altitudeFilter.max).toBe(25000);
      expect(result.current.altitudeFilter.preset).toBe('custom');
    });

    it('should set both min and max values', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setCustomRange(10000, 30000);
      });

      expect(result.current.altitudeFilter.min).toBe(10000);
      expect(result.current.altitudeFilter.max).toBe(30000);
    });

    it('should clamp min to 0', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setCustomRange(-1000, undefined);
      });

      expect(result.current.altitudeFilter.min).toBe(0);
    });

    it('should clamp max to 60000', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setCustomRange(undefined, 100000);
      });

      expect(result.current.altitudeFilter.max).toBe(60000);
    });
  });

  describe('toggleFilter', () => {
    it('should toggle filter enabled state', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.altitudeFilter.enabled).toBe(false);

      act(() => {
        result.current.toggleFilter();
      });

      expect(result.current.altitudeFilter.enabled).toBe(true);

      act(() => {
        result.current.toggleFilter();
      });

      expect(result.current.altitudeFilter.enabled).toBe(false);
    });
  });

  describe('toggleHideFiltered', () => {
    it('should toggle between dim and hide modes', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.altitudeFilter.hideFiltered).toBe(false);

      act(() => {
        result.current.toggleHideFiltered();
      });

      expect(result.current.altitudeFilter.hideFiltered).toBe(true);

      act(() => {
        result.current.toggleHideFiltered();
      });

      expect(result.current.altitudeFilter.hideFiltered).toBe(false);
    });
  });

  describe('resetFilter', () => {
    it('should reset to default state', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      // Make some changes
      act(() => {
        result.current.setAltitudePreset('high');
        result.current.toggleHideFiltered();
      });

      // Reset
      act(() => {
        result.current.resetFilter();
      });

      expect(result.current.altitudeFilter).toEqual({
        enabled: false,
        min: 0,
        max: 60000,
        preset: 'all',
        hideFiltered: false,
      });
    });
  });

  describe('isAircraftVisible', () => {
    it('should return true when filter is disabled', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.altitudeFilter.enabled).toBe(false);
      expect(result.current.isAircraftVisible(35000)).toBe(true);
      expect(result.current.isAircraftVisible(0)).toBe(true);
      expect(result.current.isAircraftVisible('ground')).toBe(true);
    });

    it('should filter by altitude when enabled', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('high'); // 18,000 - 29,000ft
      });

      expect(result.current.isAircraftVisible(25000)).toBe(true);
      expect(result.current.isAircraftVisible(18000)).toBe(true);
      expect(result.current.isAircraftVisible(29000)).toBe(true);
      expect(result.current.isAircraftVisible(10000)).toBe(false);
      expect(result.current.isAircraftVisible(35000)).toBe(false);
    });

    it('should handle ground aircraft', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('low'); // 0 - 10,000ft (includes surface)
      });

      expect(result.current.isAircraftVisible('ground')).toBe(true);
      expect(result.current.isAircraftVisible(null)).toBe(true);
      expect(result.current.isAircraftVisible(undefined)).toBe(true);

      act(() => {
        result.current.setAltitudePreset('high'); // 18,000 - 29,000ft (no surface)
      });

      expect(result.current.isAircraftVisible('ground')).toBe(false);
      expect(result.current.isAircraftVisible(null)).toBe(false);
    });

    it('should handle string altitudes', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('transition'); // 10,000 - 18,000ft
      });

      expect(result.current.isAircraftVisible('15000')).toBe(true);
      expect(result.current.isAircraftVisible('5000')).toBe(false);
    });
  });

  describe('getAircraftOpacity', () => {
    it('should return 1 when filter is disabled', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.getAircraftOpacity(35000)).toBe(1);
      expect(result.current.getAircraftOpacity(0)).toBe(1);
    });

    it('should return 1 for aircraft within range', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('high');
      });

      expect(result.current.getAircraftOpacity(25000)).toBe(1);
    });

    it('should return 0.15 for filtered aircraft in dim mode', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('high');
      });

      expect(result.current.altitudeFilter.hideFiltered).toBe(false);
      expect(result.current.getAircraftOpacity(5000)).toBe(0.15);
    });

    it('should return 0 for filtered aircraft in hide mode', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('high');
        result.current.toggleHideFiltered();
      });

      expect(result.current.altitudeFilter.hideFiltered).toBe(true);
      expect(result.current.getAircraftOpacity(5000)).toBe(0);
    });
  });

  describe('filterLabel', () => {
    it('should return null when filter is disabled', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      expect(result.current.filterLabel).toBeNull();
    });

    it('should return preset name when preset is active', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('low');
      });

      expect(result.current.filterLabel).toBe('Low');

      act(() => {
        result.current.setAltitudePreset('transition');
      });

      expect(result.current.filterLabel).toBe('Transition');
    });

    it('should return range string for custom preset', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setCustomRange(15000, 25000);
      });

      expect(result.current.filterLabel).toBe("15,000' - 25,000'");
    });
  });

  describe('localStorage persistence', () => {
    it('should save to localStorage when filter changes', () => {
      const { result } = renderHook(() => useAltitudeFilter());

      act(() => {
        result.current.setAltitudePreset('high');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'pro-altitude-filter',
        expect.any(String)
      );

      const savedValue = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]);
      expect(savedValue.preset).toBe('high');
      expect(savedValue.enabled).toBe(true);
    });
  });
});
