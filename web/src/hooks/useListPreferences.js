import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'aircraft-list-preferences';

const DEFAULT_COLUMNS = [
  { id: 'hex', label: 'ICAO', visible: true, sortable: true },
  { id: 'flight', label: 'Callsign', visible: true, sortable: true },
  { id: 'type', label: 'Type', visible: true, sortable: true },
  { id: 'alt', label: 'Altitude', visible: true, sortable: true },
  { id: 'gs', label: 'Speed', visible: true, sortable: true },
  { id: 'vr', label: 'V/S', visible: true, sortable: true },
  { id: 'track', label: 'Heading', visible: true, sortable: true },
  { id: 'distance_nm', label: 'Distance', visible: true, sortable: true },
  { id: 'rssi', label: 'Signal', visible: true, sortable: true },
  { id: 'squawk', label: 'Squawk', visible: true, sortable: false },
];

const COLUMN_PRESETS = {
  default: ['hex', 'flight', 'type', 'alt', 'gs', 'vr', 'track', 'distance_nm', 'rssi', 'squawk'],
  minimal: ['hex', 'flight', 'alt', 'gs', 'distance_nm'],
  all: DEFAULT_COLUMNS.map(c => c.id),
};

const DEFAULT_PREFERENCES = {
  viewMode: 'table', // 'table' | 'cards'
  density: 'comfortable', // 'compact' | 'comfortable'
  visibleColumns: COLUMN_PRESETS.default,
};

/**
 * Hook for managing aircraft list preferences with localStorage persistence
 */
export function useListPreferences() {
  const [preferences, setPreferences] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_PREFERENCES, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load list preferences:', e);
    }
    return DEFAULT_PREFERENCES;
  });

  // Persist to localStorage when preferences change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (e) {
      console.warn('Failed to save list preferences:', e);
    }
  }, [preferences]);

  const setViewMode = useCallback((mode) => {
    setPreferences(prev => ({ ...prev, viewMode: mode }));
  }, []);

  const setDensity = useCallback((density) => {
    setPreferences(prev => ({ ...prev, density }));
  }, []);

  const toggleColumn = useCallback((columnId) => {
    setPreferences(prev => {
      const isVisible = prev.visibleColumns.includes(columnId);
      const visibleColumns = isVisible
        ? prev.visibleColumns.filter(id => id !== columnId)
        : [...prev.visibleColumns, columnId];
      return { ...prev, visibleColumns };
    });
  }, []);

  const setColumnPreset = useCallback((preset) => {
    if (COLUMN_PRESETS[preset]) {
      setPreferences(prev => ({ ...prev, visibleColumns: COLUMN_PRESETS[preset] }));
    }
  }, []);

  const isColumnVisible = useCallback((columnId) => {
    return preferences.visibleColumns.includes(columnId);
  }, [preferences.visibleColumns]);

  const resetToDefaults = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
  }, []);

  return {
    viewMode: preferences.viewMode,
    density: preferences.density,
    visibleColumns: preferences.visibleColumns,
    columns: DEFAULT_COLUMNS,
    presets: COLUMN_PRESETS,
    setViewMode,
    setDensity,
    toggleColumn,
    setColumnPreset,
    isColumnVisible,
    resetToDefaults,
  };
}

export default useListPreferences;
