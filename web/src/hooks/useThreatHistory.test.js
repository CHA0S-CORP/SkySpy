import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThreatHistory } from './useThreatHistory';

describe('useThreatHistory', () => {
  let mockLocalStorage;

  beforeEach(() => {
    // Mock Date.now for consistent timestamps
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Mock localStorage with fresh object each time
    mockLocalStorage = {};
    const localStorageMock = {
      getItem: vi.fn((key) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with empty history', () => {
      const { result } = renderHook(() => useThreatHistory());

      expect(result.current.history).toEqual([]);
      expect(result.current.stats.totalEncounters).toBe(0);
      expect(result.current.stats.lawEnforcementCount).toBe(0);
      expect(result.current.stats.helicopterCount).toBe(0);
      expect(result.current.stats.closestApproach).toBeNull();
      expect(result.current.stats.mostRecent).toBeNull();
    });

    it('should load history from localStorage when persistent', () => {
      const savedHistory = [
        {
          id: 'ABC123-1234567890',
          hex: 'ABC123',
          callsign: 'N123AB',
          is_law_enforcement: true,
          closest_distance: 0.5,
        },
      ];
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'cannonball-threat-history') return JSON.stringify(savedHistory);
        return null;
      });

      const { result } = renderHook(() => useThreatHistory({ persistent: true }));

      expect(result.current.history).toHaveLength(1);
      expect(result.current.stats.totalEncounters).toBe(1);
      expect(result.current.stats.lawEnforcementCount).toBe(1);
    });

    it('should not load from localStorage when not persistent', () => {
      const savedHistory = [{ id: 'ABC123-1234567890', hex: 'ABC123' }];
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'cannonball-threat-history') return JSON.stringify(savedHistory);
        return null;
      });

      const { result } = renderHook(() => useThreatHistory({ persistent: false }));

      expect(result.current.history).toEqual([]);
    });
  });

  describe('logging threats', () => {
    it('should log a new threat', () => {
      const { result } = renderHook(() => useThreatHistory());

      const threat = {
        hex: 'ABC123',
        callsign: 'N123AB',
        category: 'helicopter',
        description: 'Police helicopter',
        is_law_enforcement: true,
        is_helicopter: true,
        threat_level: 'high',
        aircraft_type: 'EC35',
        registration: 'N123AB',
        distance_nm: 1.5,
        bearing: 45,
        trend: 'closing',
        lat: 37.5,
        lon: -122.5,
        altitude: 1500,
      };

      act(() => {
        result.current.logThreat(threat);
      });

      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].hex).toBe('ABC123');
      expect(result.current.history[0].callsign).toBe('N123AB');
      expect(result.current.history[0].is_law_enforcement).toBe(true);
      expect(result.current.history[0].closest_distance).toBe(1.5);
      expect(result.current.history[0].first_seen).toBeDefined();
      expect(result.current.history[0].first_position).toEqual({
        lat: 37.5,
        lon: -122.5,
        altitude: 1500,
      });
    });

    it('should update existing threat instead of adding duplicate', () => {
      const { result } = renderHook(() => useThreatHistory());

      const threat = {
        hex: 'ABC123',
        callsign: 'N123AB',
        distance_nm: 2.0,
      };

      act(() => {
        result.current.logThreat(threat);
      });

      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].closest_distance).toBe(2.0);

      // Log same threat with closer distance
      act(() => {
        vi.advanceTimersByTime(1000);
        result.current.logThreat({ ...threat, distance_nm: 1.0 });
      });

      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].closest_distance).toBe(1.0);
    });

    it('should not update closest distance if new distance is farther', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
      });

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 2.0 });
      });

      expect(result.current.history[0].closest_distance).toBe(1.0);
    });

    it('should limit history to maxEntries', () => {
      const { result } = renderHook(() => useThreatHistory({ maxEntries: 5 }));

      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.logThreat({ hex: `HEX${i}`, distance_nm: i });
        });
      }

      expect(result.current.history).toHaveLength(5);
    });

    it('should ignore null threat', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat(null);
      });

      expect(result.current.history).toHaveLength(0);
    });

    it('should persist to localStorage when persistent', () => {
      const { result } = renderHook(() => useThreatHistory({ persistent: true }));

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'cannonball-threat-history',
        expect.any(String)
      );
    });
  });

  describe('updating threats', () => {
    it('should update an existing threat', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 2.0, threat_level: 'medium' });
      });

      act(() => {
        result.current.updateThreat('ABC123', { threat_level: 'high' });
      });

      expect(result.current.history[0].threat_level).toBe('high');
    });

    it('should update closest distance when new distance is closer', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 2.0 });
      });

      act(() => {
        result.current.updateThreat('ABC123', { distance_nm: 0.5 });
      });

      expect(result.current.history[0].closest_distance).toBe(0.5);
    });

    it('should not update non-existent threat', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.updateThreat('NONEXISTENT', { threat_level: 'high' });
      });

      expect(result.current.history).toHaveLength(0);
    });

    it('should update last_seen timestamp', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 2.0 });
      });

      const initialLastSeen = result.current.history[0].last_seen;

      act(() => {
        vi.advanceTimersByTime(5000);
        result.current.updateThreat('ABC123', { trend: 'diverging' });
      });

      expect(result.current.history[0].last_seen).not.toBe(initialLastSeen);
    });
  });

  describe('statistics', () => {
    it('should calculate law enforcement count', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', is_law_enforcement: true, distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', is_law_enforcement: false, distance_nm: 1.0 });
        result.current.logThreat({ hex: 'GHI789', is_law_enforcement: true, distance_nm: 1.0 });
      });

      expect(result.current.stats.lawEnforcementCount).toBe(2);
    });

    it('should calculate helicopter count', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', is_helicopter: true, distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', is_helicopter: false, distance_nm: 1.0 });
      });

      expect(result.current.stats.helicopterCount).toBe(1);
    });

    it('should track closest approach', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', callsign: 'N123', distance_nm: 2.0 });
        result.current.logThreat({ hex: 'DEF456', callsign: 'N456', distance_nm: 0.5 });
        result.current.logThreat({ hex: 'GHI789', callsign: 'N789', distance_nm: 1.5 });
      });

      expect(result.current.stats.closestApproach.distance).toBe(0.5);
      expect(result.current.stats.closestApproach.callsign).toBe('N456');
    });

    it('should track most recent encounter', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
      });

      act(() => {
        vi.advanceTimersByTime(1000);
        result.current.logThreat({ hex: 'DEF456', distance_nm: 2.0 });
      });

      expect(result.current.stats.mostRecent.hex).toBe('DEF456');
    });
  });

  describe('clearing history', () => {
    it('should clear all history', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', distance_nm: 2.0 });
      });

      expect(result.current.history).toHaveLength(2);

      act(() => {
        result.current.clearHistory();
      });

      expect(result.current.history).toHaveLength(0);
      expect(result.current.stats.totalEncounters).toBe(0);
    });

    it('should remove localStorage when persistent', () => {
      const { result } = renderHook(() => useThreatHistory({ persistent: true }));

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
      });

      act(() => {
        result.current.clearHistory();
      });

      expect(window.localStorage.removeItem).toHaveBeenCalledWith('cannonball-threat-history');
    });
  });

  describe('removing entries', () => {
    it('should remove a specific entry', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', distance_nm: 2.0 });
      });

      const entryId = result.current.history.find((e) => e.hex === 'ABC123').id;

      act(() => {
        result.current.removeEntry(entryId);
      });

      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].hex).toBe('DEF456');
    });

    it('should update stats after removal', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', is_law_enforcement: true, distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', is_law_enforcement: false, distance_nm: 2.0 });
      });

      expect(result.current.stats.lawEnforcementCount).toBe(1);

      const entryId = result.current.history.find((e) => e.hex === 'ABC123').id;

      act(() => {
        result.current.removeEntry(entryId);
      });

      expect(result.current.stats.lawEnforcementCount).toBe(0);
    });
  });

  describe('import/export', () => {
    it('should export history as JSON', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', callsign: 'N123', distance_nm: 1.0 });
      });

      const exported = result.current.exportHistory();
      const parsed = JSON.parse(exported);

      expect(parsed.exported_at).toBeDefined();
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.stats).toBeDefined();
    });

    it('should import history from JSON', () => {
      const { result } = renderHook(() => useThreatHistory());

      const importData = {
        entries: [
          { id: 'ABC123-1', hex: 'ABC123', callsign: 'N123', closest_distance: 1.0 },
          { id: 'DEF456-2', hex: 'DEF456', callsign: 'N456', closest_distance: 2.0 },
        ],
      };

      let success;
      act(() => {
        success = result.current.importHistory(JSON.stringify(importData));
      });

      expect(success).toBe(true);
      expect(result.current.history).toHaveLength(2);
    });

    it('should limit imported entries to maxEntries', () => {
      const { result } = renderHook(() => useThreatHistory({ maxEntries: 3 }));

      const importData = {
        entries: Array.from({ length: 10 }, (_, i) => ({
          id: `HEX${i}-1`,
          hex: `HEX${i}`,
          closest_distance: i,
        })),
      };

      act(() => {
        result.current.importHistory(JSON.stringify(importData));
      });

      expect(result.current.history).toHaveLength(3);
    });

    it('should return false for invalid import data', () => {
      const { result } = renderHook(() => useThreatHistory());

      let success;
      act(() => {
        success = result.current.importHistory('invalid json');
      });

      expect(success).toBe(false);
    });

    it('should return false for data without entries array', () => {
      const { result } = renderHook(() => useThreatHistory());

      let success;
      act(() => {
        success = result.current.importHistory(JSON.stringify({ data: 'wrong format' }));
      });

      expect(success).toBe(false);
    });
  });

  describe('query functions', () => {
    it('should get encounters by threat level', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', threat_level: 'high', distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', threat_level: 'medium', distance_nm: 1.0 });
        result.current.logThreat({ hex: 'GHI789', threat_level: 'high', distance_nm: 1.0 });
      });

      const highThreats = result.current.getByThreatLevel('high');
      expect(highThreats).toHaveLength(2);
    });

    it('should get law enforcement encounters', () => {
      const { result } = renderHook(() => useThreatHistory());

      act(() => {
        result.current.logThreat({ hex: 'ABC123', is_law_enforcement: true, distance_nm: 1.0 });
        result.current.logThreat({ hex: 'DEF456', is_law_enforcement: false, distance_nm: 1.0 });
        result.current.logThreat({ hex: 'GHI789', is_law_enforcement: true, distance_nm: 1.0 });
      });

      const lawEnforcement = result.current.getLawEnforcementEncounters();
      expect(lawEnforcement).toHaveLength(2);
    });
  });

  describe('localStorage error handling', () => {
    it('should handle localStorage read errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      window.localStorage.getItem.mockImplementation(() => {
        throw new Error('localStorage error');
      });

      const { result } = renderHook(() => useThreatHistory({ persistent: true }));

      expect(result.current.history).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load threat history:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should handle localStorage write errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      window.localStorage.setItem.mockImplementation(() => {
        throw new Error('localStorage error');
      });

      const { result } = renderHook(() => useThreatHistory({ persistent: true }));

      act(() => {
        result.current.logThreat({ hex: 'ABC123', distance_nm: 1.0 });
      });

      // Should still work in memory
      expect(result.current.history).toHaveLength(1);
      consoleSpy.mockRestore();
    });
  });
});
