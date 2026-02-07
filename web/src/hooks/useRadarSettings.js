/**
 * useRadarSettings - Hook for managing Pro Radar display customization
 *
 * Features:
 * - Theme presets with customizable colors
 * - Overlay toggles (ARTCC, refueling tracks, military zones, coastlines)
 * - Performance settings (LOD preferences, trail length defaults)
 * - localStorage persistence
 */
import { useState, useCallback, useMemo } from 'react';

// Storage key for localStorage
const STORAGE_KEY = 'pro-radar-settings';

/**
 * Theme color presets
 */
export const THEME_PRESETS = {
  cyan: {
    name: 'Cyan (Default)',
    primary: '#00ffcc',
    secondary: '#0088aa',
    background: '#001122',
  },
  amber: {
    name: 'Amber',
    primary: '#ffaa00',
    secondary: '#cc8800',
    background: '#1a1000',
  },
  greenPhosphor: {
    name: 'Green Phosphor',
    primary: '#00ff00',
    secondary: '#008800',
    background: '#001100',
  },
  highContrast: {
    name: 'High Contrast',
    primary: '#ffffff',
    secondary: '#ffff00',
    background: '#000000',
  },
};

/**
 * Available overlay types
 */
export const OVERLAY_TYPES = [
  {
    key: 'artcc',
    label: 'ARTCC Boundaries',
    description: 'Air Route Traffic Control Center boundaries',
  },
  {
    key: 'refuelingTracks',
    label: 'Refueling Tracks',
    description: 'Military aerial refueling tracks',
  },
  {
    key: 'militaryZones',
    label: 'Military Zones',
    description: 'Restricted and military operating areas',
  },
  {
    key: 'coastlines',
    label: 'Coastlines',
    description: 'Coastline outlines for geographic reference',
  },
];

/**
 * Performance/LOD setting definitions
 */
export const PERFORMANCE_SETTINGS = [
  {
    key: 'lodLevel',
    label: 'Level of Detail',
    description: 'Balance between visual quality and performance',
    options: ['low', 'medium', 'high', 'ultra'],
    default: 'medium',
  },
  {
    key: 'trailLength',
    label: 'Trail Length',
    description: 'Default aircraft trail length in seconds',
    options: [30, 60, 120, 300, 600],
    default: 120,
  },
  {
    key: 'maxAircraftIcons',
    label: 'Max Aircraft Icons',
    description: 'Maximum number of detailed aircraft icons to render',
    options: [100, 250, 500, 1000],
    default: 500,
  },
];

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  // Theme settings
  theme: 'cyan',
  customColors: {
    primary: null, // null means use theme preset
    secondary: null,
    background: null,
  },

  // Overlay settings with visibility and opacity
  overlays: {
    artcc: { enabled: false, opacity: 0.5 },
    refuelingTracks: { enabled: false, opacity: 0.6 },
    militaryZones: { enabled: false, opacity: 0.4 },
    coastlines: { enabled: true, opacity: 0.3 },
  },

  // Performance settings
  performance: {
    lodLevel: 'medium',
    trailLength: 120,
    maxAircraftIcons: 500,
  },

  // Grid settings (could be centralized from elsewhere)
  grid: {
    enabled: true,
    rangeRings: true,
    rangeRingInterval: 50, // nautical miles
    compassRose: true,
  },
};

/**
 * Load config from localStorage with defaults
 */
function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Deep merge with defaults to ensure all fields exist
      return {
        theme: parsed.theme || DEFAULT_CONFIG.theme,
        customColors: {
          ...DEFAULT_CONFIG.customColors,
          ...(parsed.customColors || {}),
        },
        overlays: {
          artcc: { ...DEFAULT_CONFIG.overlays.artcc, ...(parsed.overlays?.artcc || {}) },
          refuelingTracks: {
            ...DEFAULT_CONFIG.overlays.refuelingTracks,
            ...(parsed.overlays?.refuelingTracks || {}),
          },
          militaryZones: {
            ...DEFAULT_CONFIG.overlays.militaryZones,
            ...(parsed.overlays?.militaryZones || {}),
          },
          coastlines: {
            ...DEFAULT_CONFIG.overlays.coastlines,
            ...(parsed.overlays?.coastlines || {}),
          },
        },
        performance: {
          ...DEFAULT_CONFIG.performance,
          ...(parsed.performance || {}),
        },
        grid: {
          ...DEFAULT_CONFIG.grid,
          ...(parsed.grid || {}),
        },
      };
    }
  } catch {
    // Ignore parsing errors
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); // Deep clone
}

/**
 * Save config to localStorage
 */
function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Hook for managing Pro Radar display settings
 * @returns {Object} Configuration state and update functions
 */
export function useRadarSettings() {
  const [config, setConfig] = useState(loadConfig);

  /**
   * Set the active theme preset
   */
  const setTheme = useCallback((theme) => {
    if (!THEME_PRESETS[theme]) {
      console.warn(`[RadarSettings] Unknown theme: ${theme}`);
      return;
    }
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        theme,
        // Clear custom colors when switching to a preset
        customColors: {
          primary: null,
          secondary: null,
          background: null,
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Set a custom color (overrides theme preset for that color)
   */
  const setCustomColor = useCallback((colorKey, value) => {
    if (!['primary', 'secondary', 'background'].includes(colorKey)) {
      console.warn(`[RadarSettings] Unknown color key: ${colorKey}`);
      return;
    }
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        customColors: {
          ...prev.customColors,
          [colorKey]: value,
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Clear a custom color (revert to theme preset)
   */
  const clearCustomColor = useCallback((colorKey) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        customColors: {
          ...prev.customColors,
          [colorKey]: null,
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Toggle an overlay on/off
   */
  const toggleOverlay = useCallback((overlayKey) => {
    setConfig((prev) => {
      if (!prev.overlays[overlayKey]) return prev;
      const newConfig = {
        ...prev,
        overlays: {
          ...prev.overlays,
          [overlayKey]: {
            ...prev.overlays[overlayKey],
            enabled: !prev.overlays[overlayKey].enabled,
          },
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Set overlay enabled state
   */
  const setOverlayEnabled = useCallback((overlayKey, enabled) => {
    setConfig((prev) => {
      if (!prev.overlays[overlayKey]) return prev;
      const newConfig = {
        ...prev,
        overlays: {
          ...prev.overlays,
          [overlayKey]: {
            ...prev.overlays[overlayKey],
            enabled,
          },
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Set overlay opacity
   */
  const setOverlayOpacity = useCallback((overlayKey, opacity) => {
    setConfig((prev) => {
      if (!prev.overlays[overlayKey]) return prev;
      const clampedOpacity = Math.max(0, Math.min(1, opacity));
      const newConfig = {
        ...prev,
        overlays: {
          ...prev.overlays,
          [overlayKey]: {
            ...prev.overlays[overlayKey],
            opacity: clampedOpacity,
          },
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Update a performance setting
   */
  const setPerformanceSetting = useCallback((settingKey, value) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        performance: {
          ...prev.performance,
          [settingKey]: value,
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Update a grid setting
   */
  const setGridSetting = useCallback((settingKey, value) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        grid: {
          ...prev.grid,
          [settingKey]: value,
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Reset all settings to defaults
   */
  const resetToDefaults = useCallback(() => {
    const defaultCopy = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    setConfig(defaultCopy);
    saveConfig(defaultCopy);
  }, []);

  /**
   * Set entire configuration at once
   */
  const setFullConfig = useCallback((newConfig) => {
    const merged = {
      theme: newConfig.theme || DEFAULT_CONFIG.theme,
      customColors: {
        ...DEFAULT_CONFIG.customColors,
        ...(newConfig.customColors || {}),
      },
      overlays: {
        artcc: { ...DEFAULT_CONFIG.overlays.artcc, ...(newConfig.overlays?.artcc || {}) },
        refuelingTracks: {
          ...DEFAULT_CONFIG.overlays.refuelingTracks,
          ...(newConfig.overlays?.refuelingTracks || {}),
        },
        militaryZones: {
          ...DEFAULT_CONFIG.overlays.militaryZones,
          ...(newConfig.overlays?.militaryZones || {}),
        },
        coastlines: {
          ...DEFAULT_CONFIG.overlays.coastlines,
          ...(newConfig.overlays?.coastlines || {}),
        },
      },
      performance: {
        ...DEFAULT_CONFIG.performance,
        ...(newConfig.performance || {}),
      },
      grid: {
        ...DEFAULT_CONFIG.grid,
        ...(newConfig.grid || {}),
      },
    };
    setConfig(merged);
    saveConfig(merged);
  }, []);

  /**
   * Get the active colors (custom colors override theme presets)
   */
  const activeColors = useMemo(() => {
    const themeColors = THEME_PRESETS[config.theme] || THEME_PRESETS.cyan;
    return {
      primary: config.customColors.primary || themeColors.primary,
      secondary: config.customColors.secondary || themeColors.secondary,
      background: config.customColors.background || themeColors.background,
    };
  }, [config.theme, config.customColors]);

  /**
   * Check if using custom colors (any color is customized)
   */
  const hasCustomColors = useMemo(() => {
    return Object.values(config.customColors).some((color) => color !== null);
  }, [config.customColors]);

  /**
   * Get count of enabled overlays
   */
  const enabledOverlayCount = useMemo(() => {
    return Object.values(config.overlays).filter((overlay) => overlay.enabled).length;
  }, [config.overlays]);

  /**
   * Get the current theme preset info
   */
  const currentTheme = useMemo(() => {
    return {
      key: config.theme,
      ...THEME_PRESETS[config.theme],
    };
  }, [config.theme]);

  return {
    // State
    config,
    activeColors,
    currentTheme,
    hasCustomColors,
    enabledOverlayCount,

    // Theme actions
    setTheme,
    setCustomColor,
    clearCustomColor,

    // Overlay actions
    toggleOverlay,
    setOverlayEnabled,
    setOverlayOpacity,

    // Performance actions
    setPerformanceSetting,

    // Grid actions
    setGridSetting,

    // General actions
    resetToDefaults,
    setFullConfig,
  };
}

export default useRadarSettings;
