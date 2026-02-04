import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioFavorites } from './useAudioFavorites';

describe('useAudioFavorites', () => {
  let mockLocalStorage;

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {
      store: {},
      getItem: vi.fn((key) => mockLocalStorage.store[key] || null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage.store[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete mockLocalStorage.store[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage.store = {};
      }),
    };

    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should start with empty favorites', () => {
      const { result } = renderHook(() => useAudioFavorites());

      expect(result.current.favorites).toEqual([]);
      expect(result.current.favoritesCount).toBe(0);
    });

    it('should load existing favorites from localStorage', () => {
      const existingFavorites = [
        { id: 'trans-1', callsign: 'UAL123', addedAt: '2024-01-01T00:00:00Z' },
        { id: 'trans-2', callsign: 'AAL456', addedAt: '2024-01-01T00:01:00Z' },
      ];
      mockLocalStorage.store['audio-favorites'] = JSON.stringify(existingFavorites);

      const { result } = renderHook(() => useAudioFavorites());

      expect(result.current.favorites).toEqual(existingFavorites);
      expect(result.current.favoritesCount).toBe(2);
    });

    it('should handle invalid JSON in localStorage gracefully', () => {
      mockLocalStorage.store['audio-favorites'] = 'invalid json';
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useAudioFavorites());

      expect(result.current.favorites).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-array data in localStorage gracefully', () => {
      mockLocalStorage.store['audio-favorites'] = JSON.stringify({ not: 'an array' });

      const { result } = renderHook(() => useAudioFavorites());

      expect(result.current.favorites).toEqual([]);
    });
  });

  describe('addFavorite', () => {
    it('should add transmission to favorites', () => {
      const { result } = renderHook(() => useAudioFavorites());

      const transmission = {
        id: 'trans-1',
        created_at: '2024-01-01T00:00:00Z',
        channel_name: 'Tower',
        frequency_mhz: 118.1,
        transcript: 'cleared for takeoff',
        s3_url: 'https://example.com/audio.mp3',
        duration_seconds: 5.5,
        identified_airframes: [{ callsign: 'UAL123' }],
      };

      act(() => {
        result.current.addFavorite(transmission);
      });

      expect(result.current.favoritesCount).toBe(1);
      expect(result.current.favorites[0].id).toBe('trans-1');
      expect(result.current.favorites[0].callsign).toBe('UAL123');
      expect(result.current.favorites[0].channel).toBe('Tower');
      expect(result.current.favorites[0].addedAt).toBeDefined();
    });

    it('should not add duplicate favorites', () => {
      const { result } = renderHook(() => useAudioFavorites());

      const transmission = {
        id: 'trans-1',
        channel_name: 'Tower',
      };

      act(() => {
        result.current.addFavorite(transmission);
        result.current.addFavorite(transmission);
        result.current.addFavorite(transmission);
      });

      expect(result.current.favoritesCount).toBe(1);
    });

    it('should add new favorites at the beginning', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });
      act(() => {
        result.current.addFavorite({ id: 'trans-2', channel_name: 'Ground' });
      });
      act(() => {
        result.current.addFavorite({ id: 'trans-3', channel_name: 'Approach' });
      });

      expect(result.current.favorites[0].id).toBe('trans-3');
      expect(result.current.favorites[1].id).toBe('trans-2');
      expect(result.current.favorites[2].id).toBe('trans-1');
    });

    it('should limit favorites to 100 items', () => {
      const { result } = renderHook(() => useAudioFavorites());

      // Add 105 favorites one at a time
      for (let i = 0; i < 105; i++) {
        act(() => {
          result.current.addFavorite({
            id: `trans-${i}`,
            channel_name: 'Test Channel',
          });
        });
      }

      expect(result.current.favoritesCount).toBe(100);
      // Most recent should be first
      expect(result.current.favorites[0].id).toBe('trans-104');
      // Oldest should be truncated
      expect(result.current.favorites.find((f) => f.id === 'trans-0')).toBeUndefined();
    });

    it('should not add null or undefined transmissions', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite(null);
        result.current.addFavorite(undefined);
        result.current.addFavorite({});
      });

      expect(result.current.favoritesCount).toBe(0);
    });

    it('should save favorites to localStorage', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
      expect(savedData[0].id).toBe('trans-1');
    });

    it('should use Unknown Channel when channel_name is missing', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1' });
      });

      expect(result.current.favorites[0].channel).toBe('Unknown Channel');
    });
  });

  describe('isFavorite', () => {
    it('should return true if transmission is favorited', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(result.current.isFavorite('trans-1')).toBe(true);
    });

    it('should return false if transmission is not favorited', () => {
      const { result } = renderHook(() => useAudioFavorites());

      expect(result.current.isFavorite('non-existent')).toBe(false);
    });
  });

  describe('removeFavorite', () => {
    it('should remove transmission from favorites', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });
      act(() => {
        result.current.addFavorite({ id: 'trans-2', channel_name: 'Ground' });
      });

      expect(result.current.favoritesCount).toBe(2);

      act(() => {
        result.current.removeFavorite('trans-1');
      });

      expect(result.current.favoritesCount).toBe(1);
      expect(result.current.isFavorite('trans-1')).toBe(false);
      expect(result.current.isFavorite('trans-2')).toBe(true);
    });

    it('should save to localStorage after removal', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      const callCountBeforeRemoval = mockLocalStorage.setItem.mock.calls.length;

      act(() => {
        result.current.removeFavorite('trans-1');
      });

      expect(mockLocalStorage.setItem.mock.calls.length).toBeGreaterThan(callCountBeforeRemoval);
    });
  });

  describe('toggleFavorite', () => {
    it('should add favorite when not favorited', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.toggleFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(result.current.isFavorite('trans-1')).toBe(true);
    });

    it('should remove favorite when already favorited', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(result.current.isFavorite('trans-1')).toBe(true);

      act(() => {
        result.current.toggleFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(result.current.isFavorite('trans-1')).toBe(false);
    });

    it('should not toggle null or undefined transmissions', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.toggleFavorite(null);
        result.current.toggleFavorite(undefined);
        result.current.toggleFavorite({});
      });

      expect(result.current.favoritesCount).toBe(0);
    });
  });

  describe('clearFavorites', () => {
    it('should clear all favorites', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });
      act(() => {
        result.current.addFavorite({ id: 'trans-2', channel_name: 'Ground' });
      });

      expect(result.current.favoritesCount).toBe(2);

      act(() => {
        result.current.clearFavorites();
      });

      expect(result.current.favoritesCount).toBe(0);
      expect(result.current.favorites).toEqual([]);
    });

    it('should save empty array to localStorage', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
        result.current.clearFavorites();
      });

      const lastCall = mockLocalStorage.setItem.mock.calls[mockLocalStorage.setItem.mock.calls.length - 1];
      expect(JSON.parse(lastCall[1])).toEqual([]);
    });
  });

  describe('getFavorite', () => {
    it('should return favorite by ID', () => {
      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({
          id: 'trans-1',
          channel_name: 'Tower',
          frequency_mhz: 118.1,
        });
      });

      const favorite = result.current.getFavorite('trans-1');

      expect(favorite).toBeDefined();
      expect(favorite.id).toBe('trans-1');
      expect(favorite.channel).toBe('Tower');
    });

    it('should return null for non-existent favorite', () => {
      const { result } = renderHook(() => useAudioFavorites());

      const favorite = result.current.getFavorite('non-existent');

      expect(favorite).toBeNull();
    });
  });

  describe('localStorage error handling', () => {
    it('should handle localStorage setItem errors gracefully', () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage full');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useAudioFavorites());

      act(() => {
        result.current.addFavorite({ id: 'trans-1', channel_name: 'Tower' });
      });

      // Should still update local state even if localStorage fails
      expect(result.current.favoritesCount).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle localStorage getItem errors gracefully', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('Storage error');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useAudioFavorites());

      expect(result.current.favorites).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('data extraction', () => {
    it('should extract identified_airframes correctly', () => {
      const { result } = renderHook(() => useAudioFavorites());

      const transmission = {
        id: 'trans-1',
        identified_airframes: [
          { callsign: 'UAL123', hex: 'ABC123' },
          { callsign: 'AAL456', hex: 'DEF456' },
        ],
      };

      act(() => {
        result.current.addFavorite(transmission);
      });

      expect(result.current.favorites[0].identified_airframes).toEqual(transmission.identified_airframes);
    });

    it('should handle missing identified_airframes', () => {
      const { result } = renderHook(() => useAudioFavorites());

      const transmission = {
        id: 'trans-1',
        channel_name: 'Tower',
      };

      act(() => {
        result.current.addFavorite(transmission);
      });

      expect(result.current.favorites[0].identified_airframes).toEqual([]);
      expect(result.current.favorites[0].callsign).toBeNull();
    });
  });
});
