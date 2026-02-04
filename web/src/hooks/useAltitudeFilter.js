import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Altitude filter presets for Pro Mode
 * Each preset defines a min/max altitude range in feet
 */
export const ALTITUDE_PRESETS = {
  all: { label: 'All', min: 0, max: 60000 },
  low: { label: 'Low (Surface - 10,000ft)', min: 0, max: 10000 },
  transition: { label: 'Transition (10,000 - 18,000ft)', min: 10000, max: 18000 },
  high: { label: 'High (18,000 - 29,000ft)', min: 18000, max: 29000 },
  upper: { label: 'Upper (29,000 - 45,000ft)', min: 29000, max: 45000 },
  superHigh: { label: 'Super High (45,000ft+)', min: 45000, max: 60000 },
  custom: { label: 'Custom', min: null, max: null },
};

const STORAGE_KEY = 'pro-altitude-filter';
const MAX_ALTITUDE = 60000;
const MIN_ALTITUDE = 0;
const DIM_OPACITY = 0.15;

/**
 * Default altitude filter state
 */
const DEFAULT_STATE = {
  enabled: false,
  min: MIN_ALTITUDE,
  max: MAX_ALTITUDE,
  preset: 'all',
  hideFiltered: false,
};

/**
 * useAltitudeFilter - Hook for managing altitude-based aircraft filtering
 *
 * Features:
 * - Preset altitude bands (Low, Transition, High, Upper, Super High)
 * - Custom range with min/max sliders
 * - Dim or hide filtered aircraft
 * - localStorage persistence
 *
 * @returns {Object} Altitude filter state and methods
 */
export function useAltitudeFilter() {
  // Initialize state from localStorage or defaults
  const [altitudeFilter, setAltitudeFilter] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate saved state has all required fields
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STATE.enabled,
          min: typeof parsed.min === 'number' ? parsed.min : DEFAULT_STATE.min,
          max: typeof parsed.max === 'number' ? parsed.max : DEFAULT_STATE.max,
          preset: parsed.preset || DEFAULT_STATE.preset,
          hideFiltered:
            typeof parsed.hideFiltered === 'boolean'
              ? parsed.hideFiltered
              : DEFAULT_STATE.hideFiltered,
        };
      }
    } catch {
      // Ignore parse errors, use defaults
    }
    return { ...DEFAULT_STATE };
  });

  // Persist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(altitudeFilter));
    } catch {
      // Ignore storage errors
    }
  }, [altitudeFilter]);

  /**
   * Set a preset altitude band
   */
  const setAltitudePreset = useCallback((presetKey) => {
    const preset = ALTITUDE_PRESETS[presetKey];
    if (!preset) return;

    setAltitudeFilter((prev) => {
      if (presetKey === 'all') {
        // Disable filter when "All" is selected
        return {
          ...prev,
          enabled: false,
          min: preset.min,
          max: preset.max,
          preset: 'all',
        };
      }

      if (presetKey === 'custom') {
        // Keep current range when switching to custom
        return {
          ...prev,
          enabled: true,
          preset: 'custom',
        };
      }

      // Set preset range and enable filter
      return {
        ...prev,
        enabled: true,
        min: preset.min,
        max: preset.max,
        preset: presetKey,
      };
    });
  }, []);

  /**
   * Set a custom altitude range
   * @param {number|undefined} newMin - New minimum altitude (undefined to keep current)
   * @param {number|undefined} newMax - New maximum altitude (undefined to keep current)
   */
  const setCustomRange = useCallback((newMin, newMax) => {
    setAltitudeFilter((prev) => {
      const min =
        newMin !== undefined ? Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, newMin)) : prev.min;
      const max =
        newMax !== undefined ? Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, newMax)) : prev.max;

      return {
        ...prev,
        enabled: true,
        min,
        max,
        preset: 'custom',
      };
    });
  }, []);

  /**
   * Toggle filter enabled state
   */
  const toggleFilter = useCallback(() => {
    setAltitudeFilter((prev) => ({
      ...prev,
      enabled: !prev.enabled,
    }));
  }, []);

  /**
   * Toggle between dim and hide modes for filtered aircraft
   */
  const toggleHideFiltered = useCallback(() => {
    setAltitudeFilter((prev) => ({
      ...prev,
      hideFiltered: !prev.hideFiltered,
    }));
  }, []);

  /**
   * Reset filter to default state
   */
  const resetFilter = useCallback(() => {
    setAltitudeFilter({ ...DEFAULT_STATE });
  }, []);

  /**
   * Check if an aircraft should be visible based on its altitude
   * @param {number|string|null|undefined} altitude - Aircraft altitude in feet
   * @returns {boolean} True if aircraft should be visible
   */
  const isAircraftVisible = useCallback(
    (altitude) => {
      if (!altitudeFilter.enabled) return true;

      // Handle ground aircraft
      if (altitude === 'ground' || altitude === null || altitude === undefined) {
        // Ground aircraft are visible if min is 0 (includes surface)
        return altitudeFilter.min === 0;
      }

      // Parse string altitudes
      const alt = typeof altitude === 'string' ? parseFloat(altitude) : altitude;
      if (isNaN(alt)) {
        return altitudeFilter.min === 0;
      }

      // Check if within range
      return alt >= altitudeFilter.min && alt <= altitudeFilter.max;
    },
    [altitudeFilter.enabled, altitudeFilter.min, altitudeFilter.max]
  );

  /**
   * Get the opacity for an aircraft based on filter state
   * @param {number|string|null|undefined} altitude - Aircraft altitude in feet
   * @returns {number} Opacity value (1 for visible, 0.15 for dimmed, 0 for hidden)
   */
  const getAircraftOpacity = useCallback(
    (altitude) => {
      if (!altitudeFilter.enabled) return 1;

      const visible = isAircraftVisible(altitude);
      if (visible) return 1;

      // Return 0 if hiding, dimmed opacity otherwise
      return altitudeFilter.hideFiltered ? 0 : DIM_OPACITY;
    },
    [altitudeFilter.enabled, altitudeFilter.hideFiltered, isAircraftVisible]
  );

  /**
   * Get a label describing the current filter
   */
  const filterLabel = useMemo(() => {
    if (!altitudeFilter.enabled) return null;

    if (altitudeFilter.preset === 'custom') {
      const minStr = altitudeFilter.min.toLocaleString();
      const maxStr = altitudeFilter.max.toLocaleString();
      return `${minStr}' - ${maxStr}'`;
    }

    const preset = ALTITUDE_PRESETS[altitudeFilter.preset];
    if (preset) {
      // Return just the name portion (e.g., "Low" instead of "Low (Surface - 10,000ft)")
      return preset.label.split(' ')[0];
    }

    return null;
  }, [altitudeFilter.enabled, altitudeFilter.preset, altitudeFilter.min, altitudeFilter.max]);

  return {
    altitudeFilter,
    setAltitudePreset,
    setCustomRange,
    toggleFilter,
    toggleHideFiltered,
    resetFilter,
    isAircraftVisible,
    getAircraftOpacity,
    filterLabel,
  };
}

export default useAltitudeFilter;
