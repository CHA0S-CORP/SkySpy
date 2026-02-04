import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStatsData } from './useStatsData';

// Mock the useSocketApi hook
vi.mock('./useSocketApi', () => ({
  useSocketApi: vi.fn(() => ({ data: null, loading: false })),
}));

// Mock the stats helpers
vi.mock('../components/views/stats/statsHelpers', () => ({
  TIME_RANGE_HOURS: { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 },
  buildFilterParams: vi.fn(({ hours }) => `hours=${hours}`),
  computeStatsFromAircraft: vi.fn((aircraft, stats) => {
    if (!aircraft?.length) return null;
    return {
      total: aircraft.length,
      with_position: aircraft.filter((a) => a.lat && a.lon).length,
      military: aircraft.filter((a) => a.military).length,
      emergency_squawks: [],
      altitude: { ground: 0, low: 0, medium: 0, high: aircraft.length },
      messages: stats?.count || 0,
    };
  }),
  computeTopAircraft: vi.fn((aircraft) => {
    if (!aircraft?.length) return null;
    return { closest: [], fastest: [], highest: [] };
  }),
  computeAltitudeData: vi.fn(() => []),
  computeFleetBreakdown: vi.fn(() => null),
  computeSafetyEventsByType: vi.fn(() => []),
}));

import { useSocketApi } from './useSocketApi';
import {
  computeStatsFromAircraft,
  computeTopAircraft,
  computeAltitudeData,
  computeFleetBreakdown,
  computeSafetyEventsByType,
} from '../components/views/stats/statsHelpers';

describe('useStatsData', () => {
  const defaultFilters = {
    timeRange: '24h',
    showMilitaryOnly: false,
    categoryFilter: null,
    minAltitude: null,
    maxAltitude: null,
    minDistance: null,
    maxDistance: null,
    aircraftType: null,
  };

  const createDefaultProps = (overrides = {}) => ({
    apiBase: 'http://localhost:8000',
    wsRequest: vi.fn().mockResolvedValue({}),
    wsConnected: false,
    wsAircraft: null,
    wsStats: null,
    antennaAnalyticsProp: { gain: 8.0 },
    extendedStatsProp: null,
    filters: { ...defaultFilters },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useSocketApi.mockImplementation(() => ({ data: null, loading: false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should return all expected properties', () => {
      const { result } = renderHook(() => useStatsData(createDefaultProps()));

      // Core stats
      expect(result.current).toHaveProperty('stats');
      expect(result.current).toHaveProperty('top');
      expect(result.current).toHaveProperty('aircraftData');
      expect(result.current).toHaveProperty('emergencyAircraft');
      expect(result.current).toHaveProperty('messageRate');

      // Historical data
      expect(result.current).toHaveProperty('histStats');
      expect(result.current).toHaveProperty('acarsStats');
      expect(result.current).toHaveProperty('safetyStats');
      expect(result.current).toHaveProperty('sessionsData');
      expect(result.current).toHaveProperty('systemData');

      // Analytics data
      expect(result.current).toHaveProperty('trendsData');
      expect(result.current).toHaveProperty('topPerformersData');
      expect(result.current).toHaveProperty('distanceAnalytics');
      expect(result.current).toHaveProperty('speedAnalytics');
      expect(result.current).toHaveProperty('correlationData');

      // Extended stats
      expect(result.current).toHaveProperty('flightPatternsData');
      expect(result.current).toHaveProperty('geographicData');
      expect(result.current).toHaveProperty('trackingQualityData');
      expect(result.current).toHaveProperty('engagementData');
      expect(result.current).toHaveProperty('favoritesData');

      // Chart data
      expect(result.current).toHaveProperty('altitudeData');
      expect(result.current).toHaveProperty('fleetBreakdown');
      expect(result.current).toHaveProperty('safetyEventsByType');
      expect(result.current).toHaveProperty('throughputHistory');
      expect(result.current).toHaveProperty('aircraftHistory');

      // Helpers
      expect(result.current).toHaveProperty('selectedHours');
      expect(result.current).toHaveProperty('filterParams');
    });

    it('should compute selectedHours from timeRange', () => {
      const props = createDefaultProps({
        filters: { ...defaultFilters, timeRange: '6h' },
      });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.selectedHours).toBe(6);
    });

    it('should default to 24 hours for unknown timeRange', () => {
      const props = createDefaultProps({
        filters: { ...defaultFilters, timeRange: 'unknown' },
      });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.selectedHours).toBe(24);
    });
  });

  describe('WebSocket aircraft data', () => {
    it('should use wsAircraft for aircraftData', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 40.0, lon: -74.0 },
        { hex: 'DEF456', lat: 41.0, lon: -73.0 },
      ];

      const props = createDefaultProps({ wsAircraft: aircraft });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.aircraftData).toEqual(aircraft);
    });

    it('should compute stats from wsAircraft', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 40.0, lon: -74.0, alt: 35000 },
        { hex: 'DEF456', lat: 41.0, lon: -73.0, alt: 30000 },
      ];

      const props = createDefaultProps({ wsAircraft: aircraft });
      renderHook(() => useStatsData(props));

      expect(computeStatsFromAircraft).toHaveBeenCalledWith(aircraft, null);
    });

    it('should compute top aircraft from wsAircraft', () => {
      const aircraft = [
        { hex: 'ABC123', lat: 40.0, lon: -74.0, distance_nm: 10, gs: 450, alt: 35000 },
      ];

      const props = createDefaultProps({ wsAircraft: aircraft });
      renderHook(() => useStatsData(props));

      expect(computeTopAircraft).toHaveBeenCalledWith(aircraft);
    });

    it('should use wsStats for message count', () => {
      const aircraft = [{ hex: 'ABC123', lat: 40.0, lon: -74.0 }];
      const wsStats = { count: 5000 };

      const props = createDefaultProps({ wsAircraft: aircraft, wsStats });
      renderHook(() => useStatsData(props));

      expect(computeStatsFromAircraft).toHaveBeenCalledWith(aircraft, wsStats);
    });
  });

  describe('antenna analytics', () => {
    it('should use antennaAnalyticsProp when provided', () => {
      const antennaData = { gain: 8.5, range: 250 };

      const props = createDefaultProps({ antennaAnalyticsProp: antennaData });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.antennaAnalytics).toEqual(antennaData);
    });

    it('should fetch antenna analytics when not provided and connected', async () => {
      const wsRequest = vi.fn().mockResolvedValue({ gain: 8.0 });

      const props = createDefaultProps({
        wsRequest,
        wsConnected: true,
        antennaAnalyticsProp: null,
      });

      renderHook(() => useStatsData(props));

      await waitFor(() => {
        expect(wsRequest).toHaveBeenCalledWith('antenna-analytics', {});
      });
    });
  });

  describe('extended stats', () => {
    it('should use extendedStatsProp when provided', () => {
      const extendedStats = {
        flightPatterns: { patterns: ['pattern1'] },
        geographic: { regions: ['region1'] },
        trackingQuality: { score: 95 },
        engagement: { views: 100 },
      };

      const props = createDefaultProps({ extendedStatsProp: extendedStats });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.flightPatternsData).toEqual({ patterns: ['pattern1'] });
      expect(result.current.geographicData).toEqual({ regions: ['region1'] });
      expect(result.current.trackingQualityData).toEqual({ score: 95 });
      expect(result.current.engagementData).toEqual({ views: 100 });
    });
  });

  describe('chart data computation', () => {
    it('should compute altitude data', () => {
      const mockStats = { altitude: { ground: 1, low: 2, medium: 3, high: 4 } };
      computeStatsFromAircraft.mockReturnValue(mockStats);

      const props = createDefaultProps({ wsAircraft: [{ hex: 'ABC123' }] });
      renderHook(() => useStatsData(props));

      expect(computeAltitudeData).toHaveBeenCalled();
    });

    it('should compute fleet breakdown', () => {
      const props = createDefaultProps();
      renderHook(() => useStatsData(props));

      expect(computeFleetBreakdown).toHaveBeenCalled();
    });

    it('should compute safety events by type', () => {
      const props = createDefaultProps();
      renderHook(() => useStatsData(props));

      expect(computeSafetyEventsByType).toHaveBeenCalled();
    });
  });

  describe('emergency aircraft', () => {
    it('should extract emergency aircraft from stats', () => {
      const mockStats = {
        emergency_squawks: [{ hex: 'ABC123', squawk: '7700' }],
      };
      computeStatsFromAircraft.mockReturnValue(mockStats);

      const props = createDefaultProps({ wsAircraft: [{ hex: 'ABC123', squawk: '7700' }] });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.emergencyAircraft).toEqual([{ hex: 'ABC123', squawk: '7700' }]);
    });

    it('should default to empty array when no emergency aircraft', () => {
      computeStatsFromAircraft.mockReturnValue({ emergency_squawks: undefined });

      const props = createDefaultProps({ wsAircraft: [{ hex: 'ABC123' }] });
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.emergencyAircraft).toEqual([]);
    });
  });

  describe('throughput history', () => {
    it('should initialize with empty throughput history', () => {
      const props = createDefaultProps();
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.throughputHistory).toEqual([]);
      expect(result.current.aircraftHistory).toEqual([]);
    });

    it('should initialize message rate to 0', () => {
      const props = createDefaultProps();
      const { result } = renderHook(() => useStatsData(props));

      expect(result.current.messageRate).toBe(0);
    });
  });
});
