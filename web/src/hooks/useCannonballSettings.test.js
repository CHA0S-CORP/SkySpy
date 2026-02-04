import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useCannonballSettings,
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from './useCannonballSettings';

// Mock the DEFAULT_SETTINGS import
vi.mock('../components/cannonball/SettingsPanel', () => ({
  DEFAULT_SETTINGS: {
    voiceEnabled: true,
    voiceRate: 1.0,
    audioEnabled: true,
    audioVolume: 0.7,
    hapticEnabled: true,
    hapticIntensity: 'normal',
    theme: 'dark',
    displayMode: 'single',
    showEta: true,
    showMiniRadar: true,
    showUrgencyScore: true,
    autoBrightness: true,
    threatRadius: 25,
    showAllHelicopters: true,
    showLawEnforcementOnly: false,
    altitudeFloor: 0,
    altitudeCeiling: 50000,
    ignoreAboveAltitude: 20000,
    whitelistedHexes: [],
    persistent: true,
    autoLogCritical: true,
    detectCircling: true,
    detectLoitering: true,
    loiterThreshold: 10,
    useBackend: true,
    showPatternDetails: true,
    showAgencyInfo: true,
  },
}));

import { DEFAULT_SETTINGS } from '../components/cannonball/SettingsPanel';

describe('useCannonballSettings', () => {
  let localStorageMock;

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSettings', () => {
    it('should return default settings when localStorage is empty', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const settings = loadSettings();

      expect(localStorageMock.getItem).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY);
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should return merged settings from localStorage', () => {
      const storedSettings = {
        voiceEnabled: false,
        threatRadius: 50,
      };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSettings));

      const settings = loadSettings();

      expect(settings.voiceEnabled).toBe(false);
      expect(settings.threatRadius).toBe(50);
      // Should still have default values for non-overridden settings
      expect(settings.audioEnabled).toBe(true);
      expect(settings.theme).toBe('dark');
    });

    it('should return default settings on JSON parse error', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorageMock.getItem.mockReturnValue('invalid-json');

      const settings = loadSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load cannonball settings:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('should handle localStorage access error', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage access denied');
      });

      const settings = loadSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('saveSettings', () => {
    it('should save settings to localStorage', () => {
      const settings = { voiceEnabled: false, threatRadius: 30 };

      saveSettings(settings);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(settings)
      );
    });

    it('should handle localStorage write error gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Quota exceeded');
      });

      // Should not throw
      expect(() => saveSettings({ voiceEnabled: false })).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save cannonball settings:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('useCannonballSettings hook', () => {
    it('should initialize with loaded settings', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useCannonballSettings());

      expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should initialize with stored settings', () => {
      const storedSettings = {
        voiceEnabled: false,
        threatRadius: 40,
      };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSettings));

      const { result } = renderHook(() => useCannonballSettings());

      expect(result.current.settings.voiceEnabled).toBe(false);
      expect(result.current.settings.threatRadius).toBe(40);
    });

    describe('updateSettings', () => {
      it('should update all settings and persist', () => {
        localStorageMock.getItem.mockReturnValue(null);

        const { result } = renderHook(() => useCannonballSettings());

        const newSettings = {
          ...DEFAULT_SETTINGS,
          voiceEnabled: false,
          hapticEnabled: false,
          threatRadius: 100,
        };

        act(() => {
          result.current.updateSettings(newSettings);
        });

        expect(result.current.settings).toEqual(newSettings);
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          SETTINGS_STORAGE_KEY,
          JSON.stringify(newSettings)
        );
      });
    });

    describe('updateSetting', () => {
      it('should update single setting and persist', () => {
        localStorageMock.getItem.mockReturnValue(null);

        const { result } = renderHook(() => useCannonballSettings());

        act(() => {
          result.current.updateSetting('voiceEnabled', false);
        });

        expect(result.current.settings.voiceEnabled).toBe(false);
        // Other settings should remain unchanged
        expect(result.current.settings.audioEnabled).toBe(true);
        expect(localStorageMock.setItem).toHaveBeenCalled();
      });

      it('should update multiple settings sequentially', () => {
        localStorageMock.getItem.mockReturnValue(null);

        const { result } = renderHook(() => useCannonballSettings());

        act(() => {
          result.current.updateSetting('voiceEnabled', false);
        });

        act(() => {
          result.current.updateSetting('threatRadius', 75);
        });

        act(() => {
          result.current.updateSetting('theme', 'red');
        });

        expect(result.current.settings.voiceEnabled).toBe(false);
        expect(result.current.settings.threatRadius).toBe(75);
        expect(result.current.settings.theme).toBe('red');
      });

      it('should handle numeric settings', () => {
        localStorageMock.getItem.mockReturnValue(null);

        const { result } = renderHook(() => useCannonballSettings());

        act(() => {
          result.current.updateSetting('voiceRate', 1.5);
        });

        expect(result.current.settings.voiceRate).toBe(1.5);
      });

      it('should handle array settings', () => {
        localStorageMock.getItem.mockReturnValue(null);

        const { result } = renderHook(() => useCannonballSettings());

        const hexes = ['ABC123', 'DEF456'];
        act(() => {
          result.current.updateSetting('whitelistedHexes', hexes);
        });

        expect(result.current.settings.whitelistedHexes).toEqual(hexes);
      });
    });

    describe('resetSettings', () => {
      it('should reset to default settings and persist', () => {
        const storedSettings = {
          voiceEnabled: false,
          threatRadius: 100,
        };
        localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSettings));

        const { result } = renderHook(() => useCannonballSettings());

        // Verify initial state is from storage
        expect(result.current.settings.voiceEnabled).toBe(false);
        expect(result.current.settings.threatRadius).toBe(100);

        act(() => {
          result.current.resetSettings();
        });

        expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          SETTINGS_STORAGE_KEY,
          JSON.stringify(DEFAULT_SETTINGS)
        );
      });
    });
  });

  describe('SETTINGS_STORAGE_KEY', () => {
    it('should have the correct key value', () => {
      expect(SETTINGS_STORAGE_KEY).toBe('cannonball_settings');
    });
  });

  describe('settings persistence', () => {
    it('should persist settings across renders', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const { result, rerender } = renderHook(() => useCannonballSettings());

      act(() => {
        result.current.updateSetting('voiceEnabled', false);
      });

      // Simulate localStorage returning the saved settings
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ ...DEFAULT_SETTINGS, voiceEnabled: false })
      );

      rerender();

      // State should be preserved
      expect(result.current.settings.voiceEnabled).toBe(false);
    });
  });
});
