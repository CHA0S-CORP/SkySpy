import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioHistory } from './useAudioHistory';

describe('useAudioHistory', () => {
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
    it('should start with empty history', () => {
      const { result } = renderHook(() => useAudioHistory());

      expect(result.current.history).toEqual([]);
      expect(result.current.historyCount).toBe(0);
    });

    it('should load existing history from localStorage', () => {
      const existingHistory = [
        { id: 'trans-1', callsign: 'UAL123', playedAt: '2024-01-01T00:00:00Z' },
        { id: 'trans-2', callsign: 'AAL456', playedAt: '2024-01-01T00:01:00Z' },
      ];
      mockLocalStorage.store['audio-history'] = JSON.stringify(existingHistory);

      const { result } = renderHook(() => useAudioHistory());

      expect(result.current.history).toEqual(existingHistory);
      expect(result.current.historyCount).toBe(2);
    });

    it('should handle invalid JSON in localStorage gracefully', () => {
      mockLocalStorage.store['audio-history'] = 'invalid json';
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useAudioHistory());

      expect(result.current.history).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-array data in localStorage gracefully', () => {
      mockLocalStorage.store['audio-history'] = JSON.stringify({ not: 'an array' });

      const { result } = renderHook(() => useAudioHistory());

      expect(result.current.history).toEqual([]);
    });
  });

  describe('addToHistory', () => {
    it('should add transmission to history', () => {
      const { result } = renderHook(() => useAudioHistory());

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
        result.current.addToHistory(transmission);
      });

      expect(result.current.historyCount).toBe(1);
      expect(result.current.history[0].id).toBe('trans-1');
      expect(result.current.history[0].callsign).toBe('UAL123');
      expect(result.current.history[0].channel).toBe('Tower');
      expect(result.current.history[0].playedAt).toBeDefined();
    });

    it('should move existing entry to top when replayed', () => {
      const { result } = renderHook(() => useAudioHistory());

      // Add items one at a time with separate acts to allow state updates
      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });
      act(() => {
        result.current.addToHistory({ id: 'trans-2', channel_name: 'Ground' });
      });
      act(() => {
        result.current.addToHistory({ id: 'trans-3', channel_name: 'Approach' });
      });

      expect(result.current.history[0].id).toBe('trans-3');
      expect(result.current.historyCount).toBe(3);

      // Replay trans-1
      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(result.current.history[0].id).toBe('trans-1');
      expect(result.current.historyCount).toBe(3); // No duplicates
    });

    it('should limit history to 50 items', () => {
      const { result } = renderHook(() => useAudioHistory());

      // Add 55 transmissions one at a time
      for (let i = 0; i < 55; i++) {
        act(() => {
          result.current.addToHistory({
            id: `trans-${i}`,
            channel_name: 'Test Channel',
          });
        });
      }

      expect(result.current.historyCount).toBe(50);
      // Most recent should be first
      expect(result.current.history[0].id).toBe('trans-54');
      // Oldest should be truncated
      expect(result.current.history.find((h) => h.id === 'trans-0')).toBeUndefined();
    });

    it('should not add null or undefined transmissions', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory(null);
        result.current.addToHistory(undefined);
        result.current.addToHistory({});
      });

      expect(result.current.historyCount).toBe(0);
    });

    it('should save history to localStorage', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
      expect(savedData[0].id).toBe('trans-1');
    });

    it('should use Unknown Channel when channel_name is missing', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1' });
      });

      expect(result.current.history[0].channel).toBe('Unknown Channel');
    });
  });

  describe('isInHistory', () => {
    it('should return true if transmission is in history', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });

      expect(result.current.isInHistory('trans-1')).toBe(true);
    });

    it('should return false if transmission is not in history', () => {
      const { result } = renderHook(() => useAudioHistory());

      expect(result.current.isInHistory('non-existent')).toBe(false);
    });
  });

  describe('removeFromHistory', () => {
    it('should remove transmission from history', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });
      act(() => {
        result.current.addToHistory({ id: 'trans-2', channel_name: 'Ground' });
      });

      expect(result.current.historyCount).toBe(2);

      act(() => {
        result.current.removeFromHistory('trans-1');
      });

      expect(result.current.historyCount).toBe(1);
      expect(result.current.isInHistory('trans-1')).toBe(false);
      expect(result.current.isInHistory('trans-2')).toBe(true);
    });

    it('should save to localStorage after removal', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });

      const callCountBeforeRemoval = mockLocalStorage.setItem.mock.calls.length;

      act(() => {
        result.current.removeFromHistory('trans-1');
      });

      expect(mockLocalStorage.setItem.mock.calls.length).toBeGreaterThan(callCountBeforeRemoval);
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });
      act(() => {
        result.current.addToHistory({ id: 'trans-2', channel_name: 'Ground' });
      });

      expect(result.current.historyCount).toBe(2);

      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.historyCount).toBe(0);
      expect(result.current.history).toEqual([]);
    });

    it('should save empty array to localStorage', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
        result.current.clearHistory();
      });

      const lastCall =
        mockLocalStorage.setItem.mock.calls[mockLocalStorage.setItem.mock.calls.length - 1];
      expect(JSON.parse(lastCall[1])).toEqual([]);
    });
  });

  describe('getHistoryItem', () => {
    it('should return history item by ID', () => {
      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({
          id: 'trans-1',
          channel_name: 'Tower',
          frequency_mhz: 118.1,
        });
      });

      const item = result.current.getHistoryItem('trans-1');

      expect(item).toBeDefined();
      expect(item.id).toBe('trans-1');
      expect(item.channel).toBe('Tower');
    });

    it('should return null for non-existent item', () => {
      const { result } = renderHook(() => useAudioHistory());

      const item = result.current.getHistoryItem('non-existent');

      expect(item).toBeNull();
    });
  });

  describe('localStorage error handling', () => {
    it('should handle localStorage setItem errors gracefully', () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage full');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useAudioHistory());

      act(() => {
        result.current.addToHistory({ id: 'trans-1', channel_name: 'Tower' });
      });

      // Should still update local state even if localStorage fails
      expect(result.current.historyCount).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle localStorage getItem errors gracefully', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('Storage error');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useAudioHistory());

      expect(result.current.history).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
