import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMSAW, MSAW_THRESHOLDS, AIRPORT_EXCLUSION } from './useMSAW';

// Mock localStorage
let localStorageStore = {};
const localStorageMock = {
  getItem: vi.fn((key) => localStorageStore[key] || null),
  setItem: vi.fn((key, value) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    localStorageStore = {};
  }),
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Test fixtures
const createAircraft = (overrides = {}) => ({
  hex: 'abc123',
  lat: 47.5,
  lon: -122.3,
  alt_baro: 5000,
  alt_geom: 5000,
  alt: 5000,
  on_ground: false,
  ...overrides,
});

const createAirport = (overrides = {}) => ({
  icao: 'KSEA',
  lat: 47.449,
  lon: -122.309,
  elev: 433, // Sea-Tac elevation in feet
  name: 'Seattle-Tacoma International',
  ...overrides,
});

describe('useMSAW', () => {
  beforeEach(() => {
    // Reset storage store
    localStorageStore = {};
    // Reset all mock implementations and call history
    vi.clearAllMocks();
    // Reset mockReturnValue to default behavior
    localStorageMock.getItem.mockImplementation((key) => localStorageStore[key] || null);
  });

  describe('constants', () => {
    it('should have correct threshold values', () => {
      expect(MSAW_THRESHOLDS.WARNING).toBe(1000);
      expect(MSAW_THRESHOLDS.ALERT).toBe(500);
    });

    it('should have correct airport exclusion values', () => {
      expect(AIRPORT_EXCLUSION.RADIUS_NM).toBe(5);
      expect(AIRPORT_EXCLUSION.MAX_ALTITUDE).toBe(3000);
    });
  });

  describe('initialization', () => {
    it('should initialize with disabled state by default', () => {
      const { result } = renderHook(() => useMSAW([], []));
      expect(result.current.enabled).toBe(false);
    });

    it('should restore enabled state from localStorage', () => {
      localStorageMock.getItem.mockReturnValue('true');
      const { result } = renderHook(() => useMSAW([], []));
      expect(result.current.enabled).toBe(true);
    });

    it('should return empty warnings when disabled', () => {
      const aircraft = [createAircraft({ alt_baro: 800 })]; // Low altitude
      const airports = [createAirport()];
      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.enabled).toBe(false);
      expect(result.current.msawWarnings.size).toBe(0);
    });
  });

  describe('toggle', () => {
    it('should toggle enabled state', () => {
      const { result } = renderHook(() => useMSAW([], []));

      expect(result.current.enabled).toBe(false);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.enabled).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.enabled).toBe(false);
    });

    it('should persist enabled state to localStorage', () => {
      const { result } = renderHook(() => useMSAW([], []));

      act(() => {
        result.current.toggle();
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('pro-msaw-enabled', 'true');
    });
  });

  describe('MSAW warnings', () => {
    it('should detect alert status when aircraft below 500ft AGL', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })]; // Far airport
      const aircraft = [createAircraft({ hex: 'low123', alt_baro: 400 })]; // 400ft MSL, 0 elevation = 400ft AGL

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.enabled).toBe(true);
      expect(result.current.hasAlert('low123')).toBe(true);

      const warning = result.current.getWarning('low123');
      expect(warning).not.toBeNull();
      expect(warning.status).toBe('alert');
    });

    it('should detect warning status when aircraft between 500-1000ft AGL', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })]; // Far airport
      const aircraft = [createAircraft({ hex: 'med123', alt_baro: 800 })]; // 800ft AGL

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.hasWarning('med123')).toBe(true);
      expect(result.current.hasAlert('med123')).toBe(false);

      const warning = result.current.getWarning('med123');
      expect(warning.status).toBe('warning');
    });

    it('should not warn for aircraft above 1000ft AGL', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })]; // Far airport
      const aircraft = [createAircraft({ hex: 'high123', alt_baro: 5000 })]; // 5000ft AGL

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.hasWarning('high123')).toBe(false);
      expect(result.current.getWarning('high123')).toBeNull();
    });

    it('should use nearest airport elevation for AGL calculation', () => {
      localStorageMock.getItem.mockReturnValue('true');

      // Aircraft at 4500ft MSL, nearest airport (>5nm away) at 4000ft elevation = 500ft AGL
      // Far enough from airport to not trigger exclusion (> 5nm), but close enough for elevation reference
      const airports = [
        createAirport({ icao: 'HIGH', lat: 47.6, lon: -122.4, elev: 4000 }), // ~7nm away
        createAirport({ icao: 'FAR', lat: 48.0, lon: -123.0, elev: 0 }),
      ];
      const aircraft = [createAircraft({ hex: 'test1', lat: 47.5, lon: -122.3, alt_baro: 4500 })];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      // 4500 - 4000 = 500ft AGL, which is at the alert threshold
      const warning = result.current.getWarning('test1');
      expect(warning).not.toBeNull();
      expect(warning.agl).toBe(500);
      expect(warning.status).toBe('alert');
    });
  });

  describe('airport exclusion', () => {
    it('should exclude aircraft near airports below 3000ft', () => {
      localStorageMock.getItem.mockReturnValue('true');

      // Aircraft at low altitude, very close to airport
      const airports = [createAirport({ lat: 47.5, lon: -122.3, elev: 400 })]; // Same location
      const aircraft = [createAircraft({ hex: 'near123', lat: 47.5, lon: -122.3, alt_baro: 800 })];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      // Should be excluded because it's within 5nm and below 3000ft
      expect(result.current.getWarning('near123')).toBeNull();
    });

    it('should not exclude aircraft above 3000ft even if near airport', () => {
      localStorageMock.getItem.mockReturnValue('true');

      // Aircraft at high altitude near airport - not on approach
      const airports = [createAirport({ lat: 47.5, lon: -122.3, elev: 0 })];
      const aircraft = [createAircraft({ hex: 'high123', lat: 47.5, lon: -122.3, alt_baro: 3500 })];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      // Not excluded, but also not low enough for MSAW warning
      expect(result.current.getWarning('high123')).toBeNull();
    });

    it('should not exclude aircraft far from airports', () => {
      localStorageMock.getItem.mockReturnValue('true');

      // Aircraft at low altitude, but far from airport (> 5nm)
      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })]; // ~35nm away
      const aircraft = [createAircraft({ hex: 'far123', lat: 47.5, lon: -122.3, alt_baro: 800 })];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      // Should have warning because it's far from airport
      expect(result.current.hasWarning('far123')).toBe(true);
    });
  });

  describe('ground aircraft', () => {
    it('should skip aircraft on ground (alt_baro = "ground")', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })];
      const aircraft = [createAircraft({ hex: 'gnd1', alt_baro: 'ground' })];

      const { result } = renderHook(() => useMSAW(aircraft, airports));
      expect(result.current.getWarning('gnd1')).toBeNull();
    });

    it('should skip aircraft with on_ground flag', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })];
      const aircraft = [createAircraft({ hex: 'gnd2', on_ground: true, alt_baro: 100 })];

      const { result } = renderHook(() => useMSAW(aircraft, airports));
      expect(result.current.getWarning('gnd2')).toBeNull();
    });
  });

  describe('counts', () => {
    it('should return correct warning counts', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })]; // Far airport
      const aircraft = [
        createAircraft({ hex: 'alert1', alt_baro: 400 }), // Alert (< 500ft)
        createAircraft({ hex: 'alert2', alt_baro: 300 }), // Alert
        createAircraft({ hex: 'warn1', alt_baro: 800 }), // Warning (500-1000ft)
        createAircraft({ hex: 'safe1', alt_baro: 5000 }), // Safe (> 1000ft)
      ];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.counts.alerts).toBe(2);
      expect(result.current.counts.warnings).toBe(1);
      expect(result.current.counts.total).toBe(3);
    });
  });

  describe('affectedAircraft', () => {
    it('should return list of affected aircraft', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const airports = [createAirport({ lat: 48.0, lon: -123.0, elev: 0 })];
      const aircraft = [
        createAircraft({ hex: 'low1', alt_baro: 400 }),
        createAircraft({ hex: 'low2', alt_baro: 800 }),
      ];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.affectedAircraft).toHaveLength(2);
      expect(result.current.affectedAircraft.map((a) => a.hex)).toContain('low1');
      expect(result.current.affectedAircraft.map((a) => a.hex)).toContain('low2');
    });
  });

  describe('missing data handling', () => {
    it('should handle empty aircraft array', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const { result } = renderHook(() => useMSAW([], []));

      expect(result.current.msawWarnings.size).toBe(0);
      expect(result.current.counts.total).toBe(0);
    });

    it('should handle aircraft without position data', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const aircraft = [createAircraft({ hex: 'nopos', lat: null, lon: null, alt_baro: 400 })];
      const airports = [createAirport()];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.getWarning('nopos')).toBeNull();
    });

    it('should handle aircraft without altitude data', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const aircraft = [
        createAircraft({ hex: 'noalt', alt_baro: null, alt_geom: null, alt: null }),
      ];
      const airports = [createAirport()];

      const { result } = renderHook(() => useMSAW(aircraft, airports));

      expect(result.current.getWarning('noalt')).toBeNull();
    });

    it('should work without airport data (uses default terrain)', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const aircraft = [createAircraft({ hex: 'test', alt_baro: 400 })];

      const { result } = renderHook(() => useMSAW(aircraft, []));

      // Uses default terrain elevation of 0, so 400ft is still alert level
      expect(result.current.hasAlert('test')).toBe(true);
    });
  });

  describe('localStorage persistence', () => {
    it('should save enabled state to localStorage on change', () => {
      const { result } = renderHook(() => useMSAW([], []));

      act(() => {
        result.current.setEnabled(true);
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('pro-msaw-enabled', 'true');

      act(() => {
        result.current.setEnabled(false);
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('pro-msaw-enabled', 'false');
    });
  });
});
