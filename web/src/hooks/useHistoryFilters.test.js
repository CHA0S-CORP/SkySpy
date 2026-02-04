import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistoryFilters } from './useHistoryFilters';

// Mock the historyConstants module
vi.mock('../components/history/historyConstants', () => ({
  AIRCRAFT_TYPE_CATEGORIES: {
    helicopter: ['R22', 'R44', 'EC35', 'AS50'],
    heavy: ['B744', 'B748', 'A388', 'B77W', 'A359'],
    medium: ['A320', 'B738', 'B737', 'A321'],
    light: ['C172', 'C182', 'PA28', 'SR22'],
  },
}));

// Expected default filters (must match DEFAULT_FILTERS in the hook)
const EXPECTED_DEFAULT_FILTERS = {
  search: '',
  types: [],
  categories: [],
  airlines: [],
  distanceRange: [0, 300],
  altitudeRange: [0, 45000],
  durationRange: [0, 240],
  signalRange: [-30, 0],
  militaryOnly: false,
  safetyOnly: false,
  hasCallsign: false,
  emergencyOnly: false,
};

describe('useHistoryFilters', () => {
  const sampleSessions = [
    { icao_hex: 'A12345', callsign: 'UAL123', type: 'A320', tail_number: 'N12345', is_military: false, safety_event_count: 0, min_distance_nm: 50, max_alt: 35000, duration_min: 45, max_rssi: -8 },
    { icao_hex: 'B67890', callsign: 'MIL001', type: 'F16', tail_number: 'AF001', is_military: true, safety_event_count: 0, min_distance_nm: 100, max_alt: 40000, duration_min: 30, max_rssi: -15 },
    { icao_hex: 'C11111', callsign: 'N456AB', type: 'C172', tail_number: 'N456AB', is_military: false, safety_event_count: 2, min_distance_nm: 25, max_alt: 5000, duration_min: 120, max_rssi: -5, squawk: '7700' },
    { icao_hex: 'D22222', callsign: 'DAL789', type: 'B738', tail_number: 'N789DA', is_military: false, safety_event_count: 0, min_distance_nm: 150, max_alt: 38000, duration_min: 60, max_rssi: -12 },
    { icao_hex: 'E33333', callsign: null, type: 'UNKNOWN', tail_number: null, is_military: false, safety_event_count: 0, min_distance_nm: 200, max_alt: 30000, duration_min: 15, max_rssi: -20 },
  ];

  describe('initialization', () => {
    it('should initialize with default filters', () => {
      const { result } = renderHook(() => useHistoryFilters());

      expect(result.current.filters).toEqual(EXPECTED_DEFAULT_FILTERS);
    });

    it('should merge initial filters with defaults', () => {
      const { result } = renderHook(() =>
        useHistoryFilters({ initialFilters: { search: 'test', militaryOnly: true } })
      );

      expect(result.current.filters.search).toBe('test');
      expect(result.current.filters.militaryOnly).toBe(true);
      expect(result.current.filters.types).toEqual([]);
    });
  });

  describe('setFilters', () => {
    it('should update filters', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'UAL' });
      });

      expect(result.current.filters.search).toBe('UAL');
    });

    it('should update URL hash params when setHashParams provided', () => {
      const setHashParams = vi.fn();
      const { result } = renderHook(() =>
        useHistoryFilters({ setHashParams })
      );

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'test' });
      });

      expect(setHashParams).toHaveBeenCalled();
    });

    it('should include search in hash params', () => {
      const setHashParams = vi.fn((fn) => fn({}));
      const { result } = renderHook(() =>
        useHistoryFilters({ setHashParams })
      );

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'test' });
      });

      expect(setHashParams).toHaveBeenCalled();
    });

    it('should include types in hash params', () => {
      const setHashParams = vi.fn((fn) => fn({}));
      const { result } = renderHook(() =>
        useHistoryFilters({ setHashParams })
      );

      act(() => {
        result.current.setFilters({ ...result.current.filters, types: ['A320', 'B738'] });
      });

      expect(setHashParams).toHaveBeenCalled();
    });

    it('should include military flag in hash params', () => {
      const setHashParams = vi.fn((fn) => fn({}));
      const { result } = renderHook(() =>
        useHistoryFilters({ setHashParams })
      );

      act(() => {
        result.current.setFilters({ ...result.current.filters, militaryOnly: true });
      });

      expect(setHashParams).toHaveBeenCalled();
    });
  });

  describe('resetFilters', () => {
    it('should reset all filters to defaults', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({
          ...EXPECTED_DEFAULT_FILTERS,
          search: 'test',
          types: ['A320'],
          categories: ['heavy'],
          airlines: ['UAL'],
          distanceRange: [50, 150],
          altitudeRange: [10000, 30000],
          durationRange: [30, 120],
          signalRange: [-20, -5],
          militaryOnly: true,
          safetyOnly: true,
          hasCallsign: true,
          emergencyOnly: true,
        });
      });

      act(() => {
        result.current.resetFilters();
      });

      expect(result.current.filters).toEqual(EXPECTED_DEFAULT_FILTERS);
    });
  });

  describe('filterSessions', () => {
    it('should return all sessions when no filters active', () => {
      const { result } = renderHook(() => useHistoryFilters());
      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(5);
    });

    it('should filter by search (callsign)', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'UAL' });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].callsign).toBe('UAL123');
    });

    it('should filter by search (ICAO hex)', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'A12345' });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
    });

    it('should filter by search (aircraft type)', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'A320' });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
    });

    it('should filter by search (tail number)', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'N12345' });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
    });

    it('should filter by type', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, types: ['A320'] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('A320');
    });

    it('should filter by multiple types', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, types: ['A320', 'B738'] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(2);
    });

    it('should filter by category (military)', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, categories: ['military'] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].is_military).toBe(true);
    });

    it('should filter by category (light)', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, categories: ['light'] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('C172');
    });

    it('should filter by distance range', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, distanceRange: [0, 50] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(2); // 50nm and 25nm
    });

    it('should filter by altitude range', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, altitudeRange: [30000, 45000] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(4); // 35000, 40000, 38000, 30000
    });

    it('should filter by duration range', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, durationRange: [30, 60] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(3); // 45, 30, 60
    });

    it('should filter by signal range', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, signalRange: [-10, 0] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(2); // -8, -5
    });

    it('should filter by airline prefix', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, airlines: ['UAL'] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].callsign).toBe('UAL123');
    });

    it('should filter by multiple airlines', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, airlines: ['UAL', 'DAL'] });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(2);
    });

    it('should filter by hasCallsign', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, hasCallsign: true });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(4); // All except E33333 which has null callsign
    });

    it('should filter by emergencyOnly', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, emergencyOnly: true });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].squawk).toBe('7700');
    });

    it('should filter by militaryOnly flag', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, militaryOnly: true });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].is_military).toBe(true);
    });

    it('should filter by safetyOnly flag', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, safetyOnly: true });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].safety_event_count).toBe(2);
    });

    it('should combine multiple filters', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({
          ...result.current.filters,
          distanceRange: [0, 50],
          altitudeRange: [30000, 40000],
        });
      });

      const filtered = result.current.filterSessions(sampleSessions);
      // Only A12345 with 50nm and 35000ft matches both criteria
      expect(filtered).toHaveLength(1);
      expect(filtered[0].icao_hex).toBe('A12345');
    });

    it('should handle empty sessions array', () => {
      const { result } = renderHook(() => useHistoryFilters());
      const filtered = result.current.filterSessions([]);
      expect(filtered).toEqual([]);
    });

    it('should handle null sessions', () => {
      const { result } = renderHook(() => useHistoryFilters());
      const filtered = result.current.filterSessions(null);
      expect(filtered).toEqual([]);
    });
  });

  describe('filterSightings', () => {
    const sampleSightings = [
      { icao_hex: 'A12345', callsign: 'UAL123', distance_nm: 50, altitude: 35000 },
      { icao_hex: 'B67890', callsign: 'MIL001', distance_nm: 100, altitude: 40000 },
      { icao_hex: 'C11111', callsign: 'N456AB', distance_nm: 25, altitude: 5000 },
    ];

    it('should return all sightings when no filters active', () => {
      const { result } = renderHook(() => useHistoryFilters());
      const filtered = result.current.filterSightings(sampleSightings);
      expect(filtered).toHaveLength(3);
    });

    it('should filter sightings by search', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'UAL' });
      });

      const filtered = result.current.filterSightings(sampleSightings);
      expect(filtered).toHaveLength(1);
    });

    it('should filter sightings by distance range', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, distanceRange: [0, 50] });
      });

      const filtered = result.current.filterSightings(sampleSightings);
      expect(filtered).toHaveLength(2);
    });

    it('should filter sightings by altitude range', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, altitudeRange: [30000, 45000] });
      });

      const filtered = result.current.filterSightings(sampleSightings);
      expect(filtered).toHaveLength(2);
    });

    it('should handle empty sightings array', () => {
      const { result } = renderHook(() => useHistoryFilters());
      const filtered = result.current.filterSightings([]);
      expect(filtered).toEqual([]);
    });
  });

  describe('hasActiveFilters', () => {
    it('should be false with default filters', () => {
      const { result } = renderHook(() => useHistoryFilters());
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('should be true when search is set', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, search: 'test' });
      });

      expect(result.current.hasActiveFilters).toBeTruthy();
    });

    it('should be true when types are set', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, types: ['A320'] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when categories are set', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, categories: ['heavy'] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when distance range is modified', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, distanceRange: [50, 300] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when altitude range is modified', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, altitudeRange: [0, 30000] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when militaryOnly is true', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, militaryOnly: true });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when safetyOnly is true', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, safetyOnly: true });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when airlines are set', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, airlines: ['UAL'] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when duration range is modified', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, durationRange: [30, 120] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when signal range is modified', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, signalRange: [-20, 0] });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when hasCallsign is true', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, hasCallsign: true });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('should be true when emergencyOnly is true', () => {
      const { result } = renderHook(() => useHistoryFilters());

      act(() => {
        result.current.setFilters({ ...result.current.filters, emergencyOnly: true });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });
  });

  describe('URL hash param sync', () => {
    it('should parse search from hash params', () => {
      const hashParams = { search: 'test' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.search).toBe('test');
    });

    it('should parse types from hash params', () => {
      const hashParams = { types: 'A320,B738' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.types).toEqual(['A320', 'B738']);
    });

    it('should parse categories from hash params', () => {
      const hashParams = { categories: 'heavy,military' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.categories).toEqual(['heavy', 'military']);
    });

    it('should parse distance range from hash params', () => {
      const hashParams = { distMin: '50', distMax: '150' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.distanceRange).toEqual([50, 150]);
    });

    it('should parse altitude range from hash params', () => {
      const hashParams = { altMin: '10000', altMax: '30000' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.altitudeRange).toEqual([10000, 30000]);
    });

    it('should parse military flag from hash params', () => {
      const hashParams = { military: 'true' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.militaryOnly).toBe(true);
    });

    it('should parse safety flag from hash params', () => {
      const hashParams = { safety: 'true' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.safetyOnly).toBe(true);
    });

    it('should parse airlines from hash params', () => {
      const hashParams = { airlines: 'UAL,DAL,AAL' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.airlines).toEqual(['UAL', 'DAL', 'AAL']);
    });

    it('should parse duration range from hash params', () => {
      const hashParams = { durMin: '30', durMax: '120' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.durationRange).toEqual([30, 120]);
    });

    it('should parse signal range from hash params', () => {
      const hashParams = { sigMin: '-20', sigMax: '-5' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.signalRange).toEqual([-20, -5]);
    });

    it('should parse hasCallsign from hash params', () => {
      const hashParams = { callsign: 'true' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.hasCallsign).toBe(true);
    });

    it('should parse emergencyOnly from hash params', () => {
      const hashParams = { emergency: 'true' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.emergencyOnly).toBe(true);
    });

    it('should use defaults for missing hash params', () => {
      const hashParams = { search: 'test' };
      const { result } = renderHook(() => useHistoryFilters({ hashParams }));

      expect(result.current.filters.types).toEqual([]);
      expect(result.current.filters.militaryOnly).toBe(false);
      expect(result.current.filters.airlines).toEqual([]);
      expect(result.current.filters.hasCallsign).toBe(false);
    });
  });
});
