import { useState, useCallback, useMemo } from 'react';

/**
 * useDataBlockConfig - Hook for managing aircraft data block display configuration
 *
 * Provides configurable display of aircraft information on the map:
 * - Display modes: Full, Compact, Minimal
 * - Individual field toggles with localStorage persistence
 */

// Storage key for localStorage
const STORAGE_KEY = 'adsb-pro-datablock-config';

/**
 * Field definitions for data block configuration
 * These define the toggleable fields (excluding callsign which is always on)
 */
export const FIELD_DEFINITIONS = [
  {
    key: 'altitude',
    label: 'Altitude',
    description: 'Flight level or altitude in feet',
  },
  {
    key: 'speed',
    label: 'Ground Speed',
    description: 'Speed over ground in knots',
  },
  {
    key: 'verticalSpeed',
    label: 'Vertical Speed',
    description: 'Rate of climb/descent in fpm',
  },
  {
    key: 'heading',
    label: 'Heading/Track',
    description: 'Direction of travel in degrees',
  },
  {
    key: 'type',
    label: 'Aircraft Type',
    description: 'ICAO type designator (e.g., B738)',
  },
  {
    key: 'squawk',
    label: 'Squawk',
    description: 'Transponder code',
  },
  {
    key: 'distance',
    label: 'Distance',
    description: 'Distance from receiver in nm',
  },
  {
    key: 'wakeCategory',
    label: 'Wake Category',
    description: 'Wake turbulence category (L/M/H/J)',
  },
];

/**
 * Display mode definitions
 */
export const MODE_DEFINITIONS = [
  {
    key: 'full',
    label: 'Full',
    description: 'All enabled fields on separate lines',
  },
  {
    key: 'compact',
    label: 'Compact',
    description: 'Key info on one line',
  },
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'Callsign only',
  },
];

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  mode: 'full', // 'full' | 'compact' | 'minimal'
  fields: {
    altitude: true,
    speed: true,
    verticalSpeed: false,
    heading: false,
    type: false,
    squawk: false,
    distance: false,
    wakeCategory: false,
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
      // Merge with defaults to ensure all fields exist
      return {
        mode: parsed.mode || DEFAULT_CONFIG.mode,
        fields: {
          ...DEFAULT_CONFIG.fields,
          ...(parsed.fields || {}),
        },
      };
    }
  } catch {
    // Ignore parsing errors
  }
  return { ...DEFAULT_CONFIG, fields: { ...DEFAULT_CONFIG.fields } };
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
 * Hook for managing data block configuration
 * @returns {Object} Configuration state and update functions
 */
export function useDataBlockConfig() {
  const [config, setConfig] = useState(loadConfig);

  /**
   * Update a single field's visibility
   */
  const updateField = useCallback((fieldKey, value) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        fields: {
          ...prev.fields,
          [fieldKey]: value,
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Set the display mode
   */
  const setMode = useCallback((mode) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        mode,
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Toggle a field's visibility
   */
  const toggleField = useCallback((fieldKey) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        fields: {
          ...prev.fields,
          [fieldKey]: !prev.fields[fieldKey],
        },
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  /**
   * Reset to default configuration
   */
  const reset = useCallback(() => {
    const defaultCopy = {
      ...DEFAULT_CONFIG,
      fields: { ...DEFAULT_CONFIG.fields },
    };
    setConfig(defaultCopy);
    saveConfig(defaultCopy);
  }, []);

  /**
   * Set entire configuration at once
   */
  const setFullConfig = useCallback((newConfig) => {
    const merged = {
      mode: newConfig.mode || DEFAULT_CONFIG.mode,
      fields: {
        ...DEFAULT_CONFIG.fields,
        ...(newConfig.fields || {}),
      },
    };
    setConfig(merged);
    saveConfig(merged);
  }, []);

  /**
   * Get enabled field count
   */
  const enabledCount = useMemo(() => {
    return Object.values(config.fields).filter(Boolean).length;
  }, [config.fields]);

  /**
   * Convert to legacy format for backward compatibility with MapView
   * Maps new config format to the old flat boolean format
   */
  const toLegacyFormat = useMemo(() => {
    return {
      showCallsign: true, // Always on
      showAltitude: config.fields.altitude,
      showSpeed: config.fields.speed,
      showHeading: config.fields.heading,
      showVerticalSpeed: config.fields.verticalSpeed,
      showAircraftType: config.fields.type,
      showSquawk: config.fields.squawk,
      showDistance: config.fields.distance,
      showWakeCategory: config.fields.wakeCategory,
      compact: config.mode === 'compact',
      minimal: config.mode === 'minimal',
    };
  }, [config]);

  return {
    config,
    updateField,
    setMode,
    toggleField,
    reset,
    setFullConfig,
    enabledCount,
    toLegacyFormat,
  };
}

export default useDataBlockConfig;
