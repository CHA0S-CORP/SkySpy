import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccessibility } from './useAccessibility';

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem: vi.fn((key) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key, value) => {
    localStorageMock.store[key] = String(value);
  }),
  removeItem: vi.fn((key) => {
    delete localStorageMock.store[key];
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {};
  }),
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('useAccessibility', () => {
  let matchMediaMock;
  let addEventListenerMock;
  let removeEventListenerMock;

  beforeEach(() => {
    // Clear localStorage mock
    localStorageMock.store = {};
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();

    // Mock matchMedia
    addEventListenerMock = vi.fn();
    removeEventListenerMock = vi.fn();
    matchMediaMock = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMediaMock;

    // Reset body classes
    document.body.className = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.highContrastMode).toBe(false);
      expect(result.current.reducedMotion).toBe(false);
      expect(result.current.screenReaderEnabled).toBe(true); // Default enabled
      expect(result.current.shapeMarkers).toBe(false);
    });

    it('should read from localStorage on init', () => {
      localStorageMock.store['adsb-pro-high-contrast'] = 'true';
      localStorageMock.store['adsb-pro-reduced-motion'] = 'true';
      localStorageMock.store['adsb-pro-screen-reader'] = 'false';
      localStorageMock.store['adsb-pro-shape-markers'] = 'true';

      const { result } = renderHook(() => useAccessibility());

      expect(result.current.highContrastMode).toBe(true);
      expect(result.current.reducedMotion).toBe(true);
      expect(result.current.screenReaderEnabled).toBe(false);
      expect(result.current.shapeMarkers).toBe(true);
    });

    it('should respect system preference for reduced motion', () => {
      matchMediaMock.mockImplementation((query) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useAccessibility());

      expect(result.current.reducedMotion).toBe(true);
    });

    it('should respect system preference for high contrast', () => {
      matchMediaMock.mockImplementation((query) => ({
        matches: query === '(prefers-contrast: more)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      const { result } = renderHook(() => useAccessibility());

      expect(result.current.highContrastMode).toBe(true);
    });
  });

  describe('setters', () => {
    it('should update highContrastMode and persist to localStorage', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setHighContrastMode(true);
      });

      expect(result.current.highContrastMode).toBe(true);
      expect(localStorageMock.store['adsb-pro-high-contrast']).toBe('true');
    });

    it('should update reducedMotion and persist to localStorage', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setReducedMotion(true);
      });

      expect(result.current.reducedMotion).toBe(true);
      expect(localStorageMock.store['adsb-pro-reduced-motion']).toBe('true');
    });

    it('should update screenReaderEnabled and persist to localStorage', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setScreenReaderEnabled(false);
      });

      expect(result.current.screenReaderEnabled).toBe(false);
      expect(localStorageMock.store['adsb-pro-screen-reader']).toBe('false');
    });

    it('should update shapeMarkers and persist to localStorage', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setShapeMarkers(true);
      });

      expect(result.current.shapeMarkers).toBe(true);
      expect(localStorageMock.store['adsb-pro-shape-markers']).toBe('true');
    });

    it('should support functional updates', () => {
      localStorageMock.store['adsb-pro-high-contrast'] = 'true';
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setHighContrastMode((prev) => !prev);
      });

      expect(result.current.highContrastMode).toBe(false);
    });
  });

  describe('toggle functions', () => {
    it('should toggle high contrast mode', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.highContrastMode).toBe(false);

      act(() => {
        result.current.toggleHighContrast();
      });

      expect(result.current.highContrastMode).toBe(true);

      act(() => {
        result.current.toggleHighContrast();
      });

      expect(result.current.highContrastMode).toBe(false);
    });

    it('should toggle reduced motion', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.reducedMotion).toBe(false);

      act(() => {
        result.current.toggleReducedMotion();
      });

      expect(result.current.reducedMotion).toBe(true);
    });

    it('should toggle screen reader', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.screenReaderEnabled).toBe(true);

      act(() => {
        result.current.toggleScreenReader();
      });

      expect(result.current.screenReaderEnabled).toBe(false);
    });

    it('should toggle shape markers', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.shapeMarkers).toBe(false);

      act(() => {
        result.current.toggleShapeMarkers();
      });

      expect(result.current.shapeMarkers).toBe(true);
    });
  });

  describe('body classes', () => {
    it('should add high-contrast-mode class to body when enabled', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setHighContrastMode(true);
      });

      expect(document.body.classList.contains('high-contrast-mode')).toBe(true);
    });

    it('should remove high-contrast-mode class when disabled', () => {
      document.body.classList.add('high-contrast-mode');
      localStorageMock.store['adsb-pro-high-contrast'] = 'true';

      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setHighContrastMode(false);
      });

      expect(document.body.classList.contains('high-contrast-mode')).toBe(false);
    });

    it('should add reduced-motion class to body when enabled', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setReducedMotion(true);
      });

      expect(document.body.classList.contains('reduced-motion')).toBe(true);
    });

    it('should add shape-markers-mode class to body when enabled', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setShapeMarkers(true);
      });

      expect(document.body.classList.contains('shape-markers-mode')).toBe(true);
    });
  });

  describe('accessibilityClasses', () => {
    it('should return empty string when no accessibility features enabled', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.accessibilityClasses).toBe('');
    });

    it('should return correct classes when features enabled', () => {
      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.setHighContrastMode(true);
        result.current.setReducedMotion(true);
        result.current.setShapeMarkers(true);
      });

      expect(result.current.accessibilityClasses).toBe(
        'high-contrast-mode reduced-motion shape-markers-mode'
      );
    });
  });

  describe('resetToDefaults', () => {
    it('should clear localStorage and reset to system preferences', () => {
      localStorageMock.store['adsb-pro-high-contrast'] = 'true';
      localStorageMock.store['adsb-pro-reduced-motion'] = 'true';
      localStorageMock.store['adsb-pro-screen-reader'] = 'false';
      localStorageMock.store['adsb-pro-shape-markers'] = 'true';

      const { result } = renderHook(() => useAccessibility());

      act(() => {
        result.current.resetToDefaults();
      });

      expect(localStorageMock.store['adsb-pro-high-contrast']).toBeUndefined();
      expect(localStorageMock.store['adsb-pro-reduced-motion']).toBeUndefined();
      expect(localStorageMock.store['adsb-pro-screen-reader']).toBeUndefined();
      expect(localStorageMock.store['adsb-pro-shape-markers']).toBeUndefined();
      expect(result.current.screenReaderEnabled).toBe(true);
      expect(result.current.shapeMarkers).toBe(false);
    });
  });

  describe('STORAGE_KEYS', () => {
    it('should expose storage keys', () => {
      const { result } = renderHook(() => useAccessibility());

      expect(result.current.STORAGE_KEYS).toEqual({
        HIGH_CONTRAST: 'adsb-pro-high-contrast',
        REDUCED_MOTION: 'adsb-pro-reduced-motion',
        SCREEN_READER: 'adsb-pro-screen-reader',
        SHAPE_MARKERS: 'adsb-pro-shape-markers',
      });
    });
  });
});
