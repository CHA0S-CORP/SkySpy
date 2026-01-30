/**
 * useCannonballSettings - Hook for managing Cannonball mode settings
 *
 * Handles:
 * - Loading settings from localStorage
 * - Saving settings to localStorage
 * - Providing default settings
 */
import { useState, useCallback } from 'react';
import { DEFAULT_SETTINGS } from '../components/cannonball/SettingsPanel';

// Storage key for settings persistence
export const SETTINGS_STORAGE_KEY = 'cannonball_settings';

/**
 * Load settings from localStorage
 */
export function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (err) {
    console.warn('Failed to load cannonball settings:', err);
  }
  return DEFAULT_SETTINGS;
}

/**
 * Save settings to localStorage
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save cannonball settings:', err);
  }
}

/**
 * useCannonballSettings hook
 */
export function useCannonballSettings() {
  // Load settings from localStorage
  const [settings, setSettings] = useState(loadSettings);

  // Handle settings change and persist
  const updateSettings = useCallback((newSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  // Update a single setting
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

  // Reset to defaults
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    updateSettings,
    updateSetting,
    resetSettings,
  };
}

export default useCannonballSettings;
