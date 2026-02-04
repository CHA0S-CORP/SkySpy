/**
 * Tests for useProTheme hook
 * Phase 5.1: Color Theme Customization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useProTheme,
  PRO_THEME_COLORS,
  THEME_IDS,
  DEFAULT_THEME,
  getThemeColors,
  applyThemeCssVariables,
} from './useProTheme';

describe('useProTheme', () => {
  // Mock localStorage
  const localStorageMock = (() => {
    let store = {};
    return {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => {
        store[key] = value.toString();
      }),
      removeItem: vi.fn((key) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };
  })();

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
    localStorageMock.clear();

    // Mock document.documentElement
    vi.spyOn(document.documentElement, 'setAttribute');
    vi.spyOn(document.documentElement.style, 'setProperty');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('theme initialization', () => {
    it('should initialize with default cyan theme', () => {
      const { result } = renderHook(() => useProTheme());
      expect(result.current.theme).toBe('cyan');
    });

    it('should load theme from localStorage if available', () => {
      localStorageMock.setItem('adsb-pro-theme', 'amber');
      const { result } = renderHook(() => useProTheme());
      expect(result.current.theme).toBe('amber');
    });

    it('should fall back to default if localStorage has invalid theme', () => {
      localStorageMock.setItem('adsb-pro-theme', 'invalid-theme');
      const { result } = renderHook(() => useProTheme());
      expect(result.current.theme).toBe(DEFAULT_THEME);
    });
  });

  describe('setTheme', () => {
    it('should update theme state', () => {
      const { result } = renderHook(() => useProTheme());
      act(() => {
        result.current.setTheme('amber');
      });
      expect(result.current.theme).toBe('amber');
    });

    it('should persist theme to localStorage', () => {
      const { result } = renderHook(() => useProTheme());
      act(() => {
        result.current.setTheme('green');
      });
      expect(localStorageMock.setItem).toHaveBeenCalledWith('adsb-pro-theme', 'green');
    });

    it('should reject invalid theme names', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useProTheme());
      act(() => {
        result.current.setTheme('invalid');
      });
      expect(result.current.theme).toBe('cyan'); // Should remain unchanged
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should set data-pro-theme attribute on document', () => {
      const { result } = renderHook(() => useProTheme());
      act(() => {
        result.current.setTheme('high-contrast');
      });
      expect(document.documentElement.setAttribute).toHaveBeenCalledWith(
        'data-pro-theme',
        'high-contrast'
      );
    });
  });

  describe('cycleTheme', () => {
    it('should cycle through all themes', () => {
      const { result } = renderHook(() => useProTheme());

      // Start at cyan
      expect(result.current.theme).toBe('cyan');

      // Cycle through all themes
      act(() => result.current.cycleTheme());
      expect(result.current.theme).toBe('amber');

      act(() => result.current.cycleTheme());
      expect(result.current.theme).toBe('green');

      act(() => result.current.cycleTheme());
      expect(result.current.theme).toBe('high-contrast');

      // Should wrap back to cyan
      act(() => result.current.cycleTheme());
      expect(result.current.theme).toBe('cyan');
    });
  });

  describe('themeColors', () => {
    it('should return theme colors for current theme', () => {
      const { result } = renderHook(() => useProTheme());
      expect(result.current.themeColors).toBeDefined();
      expect(result.current.themeColors.name).toBe('Classic Cyan');
      expect(result.current.themeColors.background).toBe('#0a0d12');
    });

    it('should update themeColors when theme changes', () => {
      const { result } = renderHook(() => useProTheme());
      act(() => {
        result.current.setTheme('amber');
      });
      expect(result.current.themeColors.name).toBe('Amber/Gold');
      expect(result.current.themeColors.background).toBe('#0d0a06');
    });

    it('should provide rgba helper function', () => {
      const { result } = renderHook(() => useProTheme());
      const rgba = result.current.themeColors.rgba('primary', 0.5);
      expect(rgba).toMatch(/^rgba\(\d+, \d+, \d+, 0\.5\)$/);
    });

    it('should provide bg helper function', () => {
      const { result } = renderHook(() => useProTheme());
      const bg = result.current.themeColors.bg();
      expect(bg).toBe('#0a0d12');
    });
  });

  describe('availableThemes', () => {
    it('should return list of all available themes', () => {
      const { result } = renderHook(() => useProTheme());
      expect(result.current.availableThemes).toHaveLength(THEME_IDS.length);
      expect(result.current.availableThemes.map((t) => t.id)).toEqual(THEME_IDS);
    });

    it('should include name and description for each theme', () => {
      const { result } = renderHook(() => useProTheme());
      result.current.availableThemes.forEach((theme) => {
        expect(theme).toHaveProperty('id');
        expect(theme).toHaveProperty('name');
        expect(theme).toHaveProperty('description');
      });
    });
  });
});

describe('PRO_THEME_COLORS', () => {
  it('should have all required themes', () => {
    expect(PRO_THEME_COLORS).toHaveProperty('cyan');
    expect(PRO_THEME_COLORS).toHaveProperty('amber');
    expect(PRO_THEME_COLORS).toHaveProperty('green');
    expect(PRO_THEME_COLORS).toHaveProperty('high-contrast');
  });

  it('should have all required color properties for each theme', () => {
    const requiredProps = [
      'name',
      'background',
      'grid',
      'gridLabel',
      'primary',
      'aircraft',
      'aircraftText',
      'vector',
      'rangeRing',
      'rangeLabel',
      'compass',
      'compassMajor',
      'dataBlockBg',
      'secondaryText',
      'css',
    ];

    Object.values(PRO_THEME_COLORS).forEach((theme) => {
      requiredProps.forEach((prop) => {
        expect(theme).toHaveProperty(prop);
      });
    });
  });

  it('should have CSS variables for each theme', () => {
    const requiredCssVars = [
      'primary',
      'primaryRgb',
      'secondary',
      'secondaryRgb',
      'background',
      'backgroundRgb',
      'text',
      'textRgb',
      'textDim',
      'textDimRgb',
      'accent',
      'accentRgb',
      'border',
      'borderRgb',
    ];

    Object.values(PRO_THEME_COLORS).forEach((theme) => {
      requiredCssVars.forEach((varName) => {
        expect(theme.css).toHaveProperty(varName);
      });
    });
  });
});

describe('getThemeColors', () => {
  it('should return theme colors for valid theme name', () => {
    const colors = getThemeColors('amber');
    expect(colors.name).toBe('Amber/Gold');
  });

  it('should fall back to cyan for invalid theme name', () => {
    const colors = getThemeColors('nonexistent');
    expect(colors.name).toBe('Classic Cyan');
  });

  it('should provide rgba helper', () => {
    const colors = getThemeColors('cyan');
    const rgba = colors.rgba('primary', 0.8);
    expect(rgba).toMatch(/^rgba\(\d+, \d+, \d+, 0\.8\)$/);
  });

  it('should provide fallback for invalid color key', () => {
    const colors = getThemeColors('cyan');
    const rgba = colors.rgba('invalidKey', 0.5);
    expect(rgba).toBe('rgba(100, 200, 255, 0.5)'); // fallback cyan
  });
});

describe('applyThemeCssVariables', () => {
  let mockElement;

  beforeEach(() => {
    mockElement = {
      style: {
        setProperty: vi.fn(),
      },
    };
  });

  it('should set all CSS variables on the element', () => {
    applyThemeCssVariables(mockElement, 'cyan');

    expect(mockElement.style.setProperty).toHaveBeenCalledWith('--pro-primary', expect.any(String));
    expect(mockElement.style.setProperty).toHaveBeenCalledWith(
      '--pro-primary-rgb',
      expect.any(String)
    );
    expect(mockElement.style.setProperty).toHaveBeenCalledWith(
      '--pro-background',
      expect.any(String)
    );
    expect(mockElement.style.setProperty).toHaveBeenCalledWith('--pro-text', expect.any(String));
    expect(mockElement.style.setProperty).toHaveBeenCalledWith('--pro-accent', expect.any(String));
    expect(mockElement.style.setProperty).toHaveBeenCalledWith('--pro-border', expect.any(String));
  });

  it('should not throw for null element', () => {
    expect(() => applyThemeCssVariables(null, 'cyan')).not.toThrow();
  });

  it('should fall back to default theme for invalid theme name', () => {
    applyThemeCssVariables(mockElement, 'invalid');
    // Should still set variables (using cyan fallback)
    expect(mockElement.style.setProperty).toHaveBeenCalled();
  });
});

describe('THEME_IDS', () => {
  it('should contain all theme keys', () => {
    expect(THEME_IDS).toContain('cyan');
    expect(THEME_IDS).toContain('amber');
    expect(THEME_IDS).toContain('green');
    expect(THEME_IDS).toContain('high-contrast');
  });

  it('should match PRO_THEME_COLORS keys', () => {
    expect(THEME_IDS).toEqual(Object.keys(PRO_THEME_COLORS));
  });
});

describe('DEFAULT_THEME', () => {
  it('should be cyan', () => {
    expect(DEFAULT_THEME).toBe('cyan');
  });

  it('should be a valid theme ID', () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME);
  });
});
