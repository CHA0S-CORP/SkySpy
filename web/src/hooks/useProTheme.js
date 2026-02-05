/**
 * useProTheme - Pro Mode Theme Customization Hook
 *
 * Phase 5.1: Color Theme Customization
 *
 * Manages pro mode theme selection with localStorage persistence.
 * Supports four themes:
 * - cyan: Classic Cyan (default) - Primary #00ffff, Background #0a0d12
 * - amber: Amber/Gold - Primary #ffaa00, Background #0d0a00
 * - green: Green Phosphor - Primary #00ff00, Background #000800
 * - high-contrast: High Contrast - Primary #ffffff, Background #000000
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// Storage key for theme preference
const STORAGE_KEY = 'adsb-pro-theme';

// Theme color definitions for canvas drawing
// These are RGB objects for use with canvas rgba() calls
export const PRO_THEME_COLORS = {
  // Classic Cyan (default) - modern ATC style
  cyan: {
    id: 'cyan',
    name: 'Classic Cyan',
    description: 'Modern ATC-style cyan display',
    background: '#0a0d12',
    grid: { r: 40, g: 80, b: 120 },
    gridLabel: { r: 80, g: 140, b: 180 },
    primary: { r: 100, g: 200, b: 255 },
    aircraft: { r: 0, g: 255, b: 150 },
    aircraftText: { r: 150, g: 255, b: 200 },
    vector: { r: 100, g: 200, b: 255 },
    rangeRing: { r: 60, g: 100, b: 140 },
    rangeLabel: { r: 80, g: 130, b: 170 },
    compass: { r: 80, g: 140, b: 200 },
    compassMajor: { r: 100, g: 180, b: 255 },
    dataBlockBg: { r: 10, g: 13, b: 18 },
    secondaryText: { r: 100, g: 200, b: 180 },
    // CSS variable values
    css: {
      primary: '#00ffff',
      primaryRgb: '0, 255, 255',
      secondary: '#64c8ff',
      secondaryRgb: '100, 200, 255',
      background: '#0a0d12',
      backgroundRgb: '10, 13, 18',
      text: '#96ffc8',
      textRgb: '150, 255, 200',
      textDim: '#508cB4',
      textDimRgb: '80, 140, 180',
      accent: '#00ff96',
      accentRgb: '0, 255, 150',
      border: '#28506e',
      borderRgb: '40, 80, 110',
    },
  },
  // Amber/Gold - traditional ATC amber colors
  amber: {
    id: 'amber',
    name: 'Amber/Gold',
    description: 'Traditional ATC amber display',
    background: '#0d0a06',
    grid: { r: 120, g: 90, b: 40 },
    gridLabel: { r: 180, g: 140, b: 60 },
    primary: { r: 255, g: 180, b: 60 },
    aircraft: { r: 255, g: 200, b: 80 },
    aircraftText: { r: 255, g: 220, b: 150 },
    vector: { r: 255, g: 180, b: 100 },
    rangeRing: { r: 140, g: 100, b: 50 },
    rangeLabel: { r: 170, g: 130, b: 70 },
    compass: { r: 200, g: 150, b: 70 },
    compassMajor: { r: 255, g: 200, b: 100 },
    dataBlockBg: { r: 18, g: 14, b: 8 },
    secondaryText: { r: 200, g: 160, b: 100 },
    css: {
      primary: '#ffaa00',
      primaryRgb: '255, 170, 0',
      secondary: '#ffb43c',
      secondaryRgb: '255, 180, 60',
      background: '#0d0a06',
      backgroundRgb: '13, 10, 6',
      text: '#ffdc96',
      textRgb: '255, 220, 150',
      textDim: '#b48c3c',
      textDimRgb: '180, 140, 60',
      accent: '#ffc850',
      accentRgb: '255, 200, 80',
      border: '#785a28',
      borderRgb: '120, 90, 40',
    },
  },
  // Green Phosphor - retro terminal style
  green: {
    id: 'green',
    name: 'Green Phosphor',
    description: 'Retro phosphor terminal style',
    background: '#0a0f0a',
    grid: { r: 40, g: 100, b: 50 },
    gridLabel: { r: 80, g: 160, b: 90 },
    primary: { r: 80, g: 255, b: 120 },
    aircraft: { r: 60, g: 255, b: 100 },
    aircraftText: { r: 150, g: 255, b: 170 },
    vector: { r: 100, g: 220, b: 130 },
    rangeRing: { r: 50, g: 120, b: 60 },
    rangeLabel: { r: 70, g: 150, b: 80 },
    compass: { r: 70, g: 180, b: 90 },
    compassMajor: { r: 100, g: 255, b: 140 },
    dataBlockBg: { r: 10, g: 18, b: 12 },
    secondaryText: { r: 100, g: 200, b: 120 },
    css: {
      primary: '#00ff00',
      primaryRgb: '0, 255, 0',
      secondary: '#50ff78',
      secondaryRgb: '80, 255, 120',
      background: '#0a0f0a',
      backgroundRgb: '10, 15, 10',
      text: '#96ffaa',
      textRgb: '150, 255, 170',
      textDim: '#50a05a',
      textDimRgb: '80, 160, 90',
      accent: '#3cff64',
      accentRgb: '60, 255, 100',
      border: '#28643c',
      borderRgb: '40, 100, 60',
    },
  },
  // High Contrast - pure white on black for accessibility
  'high-contrast': {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'High contrast for accessibility',
    background: '#000000',
    grid: { r: 80, g: 80, b: 80 },
    gridLabel: { r: 180, g: 180, b: 180 },
    primary: { r: 255, g: 255, b: 255 },
    aircraft: { r: 255, g: 255, b: 255 },
    aircraftText: { r: 255, g: 255, b: 255 },
    vector: { r: 200, g: 200, b: 200 },
    rangeRing: { r: 100, g: 100, b: 100 },
    rangeLabel: { r: 160, g: 160, b: 160 },
    compass: { r: 150, g: 150, b: 150 },
    compassMajor: { r: 255, g: 255, b: 255 },
    dataBlockBg: { r: 20, g: 20, b: 20 },
    secondaryText: { r: 200, g: 200, b: 200 },
    css: {
      primary: '#ffffff',
      primaryRgb: '255, 255, 255',
      secondary: '#e0e0e0',
      secondaryRgb: '224, 224, 224',
      background: '#000000',
      backgroundRgb: '0, 0, 0',
      text: '#ffffff',
      textRgb: '255, 255, 255',
      textDim: '#b4b4b4',
      textDimRgb: '180, 180, 180',
      accent: '#ffffff',
      accentRgb: '255, 255, 255',
      border: '#505050',
      borderRgb: '80, 80, 80',
    },
  },
};

// Valid theme IDs
export const THEME_IDS = Object.keys(PRO_THEME_COLORS);

// Default theme
export const DEFAULT_THEME = 'cyan';

/**
 * Helper function to get theme colors with rgba helper
 * @param {string} themeName - Theme ID
 * @returns {Object} Theme colors with rgba helper function
 */
export const getThemeColors = (themeName) => {
  const theme = PRO_THEME_COLORS[themeName] || PRO_THEME_COLORS[DEFAULT_THEME];

  return {
    ...theme,
    // Generate rgba string from color key
    rgba: (colorKey, alpha = 1) => {
      const c = theme[colorKey];
      if (!c) return `rgba(100, 200, 255, ${alpha})`; // fallback cyan
      return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
    },
    // Get background color
    bg: () => theme.background,
    // Get CSS variable value
    cssVar: (varName) => theme.css?.[varName] || '',
  };
};

/**
 * Apply theme CSS variables to a target element
 * @param {HTMLElement} element - Target element (usually document.documentElement)
 * @param {string} themeName - Theme ID
 */
export const applyThemeCssVariables = (element, themeName) => {
  const theme = PRO_THEME_COLORS[themeName] || PRO_THEME_COLORS[DEFAULT_THEME];
  const css = theme.css;

  if (!element || !css) return;

  // Set CSS custom properties
  element.style.setProperty('--pro-primary', css.primary);
  element.style.setProperty('--pro-primary-rgb', css.primaryRgb);
  element.style.setProperty('--pro-secondary', css.secondary);
  element.style.setProperty('--pro-secondary-rgb', css.secondaryRgb);
  element.style.setProperty('--pro-background', css.background);
  element.style.setProperty('--pro-background-rgb', css.backgroundRgb);
  element.style.setProperty('--pro-text', css.text);
  element.style.setProperty('--pro-text-rgb', css.textRgb);
  element.style.setProperty('--pro-text-dim', css.textDim);
  element.style.setProperty('--pro-text-dim-rgb', css.textDimRgb);
  element.style.setProperty('--pro-accent', css.accent);
  element.style.setProperty('--pro-accent-rgb', css.accentRgb);
  element.style.setProperty('--pro-border', css.border);
  element.style.setProperty('--pro-border-rgb', css.borderRgb);
};

/**
 * useProTheme hook
 *
 * Manages pro mode theme selection with:
 * - localStorage persistence
 * - CSS variable application
 * - data-theme attribute management
 *
 * @param {Object} options - Hook options
 * @param {HTMLElement} options.targetElement - Element to apply theme to (default: document.documentElement)
 * @returns {Object} Theme state and controls
 */
export function useProTheme(options = {}) {
  const { targetElement = null } = options;

  // Initialize theme from localStorage and apply immediately to prevent flash
  const [theme, setThemeState] = useState(() => {
    let savedTheme = DEFAULT_THEME;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && THEME_IDS.includes(saved)) {
        savedTheme = saved;
      }
    } catch (e) {
      console.warn('Failed to read theme from localStorage:', e);
    }
    // Apply theme immediately to prevent flash of default theme
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-pro-theme', savedTheme);
      applyThemeCssVariables(document.documentElement, savedTheme);
    }
    return savedTheme;
  });

  // Get the target element (document.documentElement if not specified)
  const getTarget = useCallback(() => {
    return targetElement || (typeof document !== 'undefined' ? document.documentElement : null);
  }, [targetElement]);

  // Apply theme to DOM
  const applyTheme = useCallback(
    (themeName) => {
      const target = getTarget();
      if (!target) return;

      // Set data-theme attribute for CSS selectors
      target.setAttribute('data-pro-theme', themeName);

      // Apply CSS variables
      applyThemeCssVariables(target, themeName);
    },
    [getTarget]
  );

  // Set theme with persistence
  const setTheme = useCallback(
    (newTheme) => {
      if (!THEME_IDS.includes(newTheme)) {
        console.warn(`Invalid theme: ${newTheme}. Valid themes: ${THEME_IDS.join(', ')}`);
        return;
      }

      setThemeState(newTheme);

      // Persist to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch (e) {
        console.warn('Failed to save theme to localStorage:', e);
      }

      // Apply to DOM
      applyTheme(newTheme);
    },
    [applyTheme]
  );

  // Cycle to next theme
  const cycleTheme = useCallback(() => {
    const currentIndex = THEME_IDS.indexOf(theme);
    const nextIndex = (currentIndex + 1) % THEME_IDS.length;
    setTheme(THEME_IDS[nextIndex]);
  }, [theme, setTheme]);

  // Apply theme on mount and when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  // Get current theme colors
  const themeColors = useMemo(() => getThemeColors(theme), [theme]);

  // Get theme metadata
  const themeInfo = useMemo(() => {
    const t = PRO_THEME_COLORS[theme] || PRO_THEME_COLORS[DEFAULT_THEME];
    return {
      id: t.id,
      name: t.name,
      description: t.description,
    };
  }, [theme]);

  // Available themes for UI
  const availableThemes = useMemo(
    () =>
      THEME_IDS.map((id) => ({
        id,
        name: PRO_THEME_COLORS[id].name,
        description: PRO_THEME_COLORS[id].description,
      })),
    []
  );

  return {
    // Current theme ID
    theme,
    // Set theme by ID
    setTheme,
    // Cycle to next theme
    cycleTheme,
    // Theme colors for canvas drawing
    themeColors,
    // Theme metadata
    themeInfo,
    // List of available themes
    availableThemes,
    // All theme definitions (for advanced use)
    themes: PRO_THEME_COLORS,
  };
}

export default useProTheme;
