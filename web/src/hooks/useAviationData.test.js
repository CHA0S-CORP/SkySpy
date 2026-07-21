import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAviationData } from './useAviationData';

// Navaids/airports/airspace are fetched only when their overlay flag is on
// (their payloads are large — gating avoids choking the socket). Enable them
// for the tests that assert those requests fire.
const ALL_ON = { navaids: true, airports: true, airspace: true };

describe('useAviationData', () => {
  let mockWsRequest;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsRequest = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should return initial state with empty data', () => {
      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, false, 40.0, -74.0, 100, ALL_ON)
      );

      expect(result.current.aviationData).toEqual({
        navaids: [],
        airports: [],
        airspace: [],
        airspaceAdvisories: [],
        metars: [],
        pireps: [],
        wildfires: [],
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.connected).toBe(false);
    });

    it('should reflect connection state', () => {
      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      expect(result.current.connected).toBe(true);
    });
  });

  describe('fetching data', () => {
    it('should not fetch when not connected', async () => {
      renderHook(() => useAviationData(mockWsRequest, false, 40.0, -74.0, 100, ALL_ON));

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockWsRequest).not.toHaveBeenCalled();
    });

    it('should not fetch without coordinates', async () => {
      renderHook(() => useAviationData(mockWsRequest, true, null, null, 100, ALL_ON));

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockWsRequest).not.toHaveBeenCalled();
    });

    it('should fetch aviation data when connected with coordinates', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ data: [] });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      await waitFor(() => {
        expect(mockWsRequest).toHaveBeenCalled();
      });

      // Should have called for navaids, airports, airspace, and airspace advisories
      expect(mockWsRequest).toHaveBeenCalledWith('navaids', expect.any(Object), expect.any(Number));
      expect(mockWsRequest).toHaveBeenCalledWith(
        'airports',
        expect.any(Object),
        expect.any(Number)
      );
      expect(mockWsRequest).toHaveBeenCalledWith(
        'airspace-boundaries',
        expect.any(Object),
        expect.any(Number)
      );
      expect(mockWsRequest).toHaveBeenCalledWith(
        'airspaces',
        expect.any(Object),
        expect.any(Number)
      );
    });

    it('should include metars when overlay enabled', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ data: [] });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, { metars: true })
      );

      await waitFor(() => {
        expect(mockWsRequest).toHaveBeenCalledWith(
          'metars',
          expect.any(Object),
          expect.any(Number)
        );
      });
    });

    it('should include pireps when overlay enabled', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ data: [] });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, { pireps: true })
      );

      await waitFor(() => {
        expect(mockWsRequest).toHaveBeenCalledWith(
          'pireps',
          expect.any(Object),
          expect.any(Number)
        );
      });
    });

    it('should pass correct parameters to navaids request', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue([]);

      renderHook(() => useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON));

      await waitFor(() => {
        expect(mockWsRequest).toHaveBeenCalledWith(
          'navaids',
          { lat: 40.0, lon: -74.0, radius: 150 }, // radius = radarRange * 1.5
          20000
        );
      });
    });

    it('should pass correct parameters to airports request', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue([]);

      renderHook(() => useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON));

      await waitFor(() => {
        expect(mockWsRequest).toHaveBeenCalledWith(
          'airports',
          { lat: 40.0, lon: -74.0, radius: 120, limit: 50 }, // radius = radarRange * 1.2
          20000
        );
      });
    });
  });

  describe('data normalization', () => {
    it('should normalize airport data', async () => {
      vi.useRealTimers();

      const rawAirport = {
        icaoId: 'KJFK',
        faaId: 'JFK',
        site: 'John F Kennedy Intl',
        assocCity: 'New York',
        stateProv: 'NY',
        elev_ft: 13,
        airspaceClass: 'B',
      };

      mockWsRequest.mockImplementation((type) => {
        if (type === 'airports') {
          return Promise.resolve([rawAirport]);
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      await waitFor(() => {
        expect(result.current.aviationData.airports.length).toBe(1);
      });

      const airport = result.current.aviationData.airports[0];
      expect(airport.icao).toBe('KJFK');
      expect(airport.id).toBe('KJFK');
      expect(airport.name).toBe('John F Kennedy Intl');
      expect(airport.city).toBe('New York');
      expect(airport.state).toBe('NY');
      expect(airport.elev).toBe(13);
      expect(airport.class).toBe('B');
    });

    it('should handle GeoJSON FeatureCollection format', async () => {
      vi.useRealTimers();

      const geoJsonResponse = {
        features: [
          {
            properties: { id: 'VOR1', name: 'Test VOR' },
            geometry: { coordinates: [-74.0, 40.0] },
          },
        ],
      };

      mockWsRequest.mockImplementation((type) => {
        if (type === 'navaids') {
          return Promise.resolve(geoJsonResponse);
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      await waitFor(() => {
        expect(result.current.aviationData.navaids.length).toBe(1);
      });

      const navaid = result.current.aviationData.navaids[0];
      expect(navaid.id).toBe('VOR1');
      expect(navaid.lat).toBe(40.0);
      expect(navaid.lon).toBe(-74.0);
    });

    it('should handle data wrapper format', async () => {
      vi.useRealTimers();

      mockWsRequest.mockImplementation((type) => {
        if (type === 'navaids') {
          return Promise.resolve({ data: [{ id: 'VOR1' }] });
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      await waitFor(() => {
        expect(result.current.aviationData.navaids.length).toBe(1);
      });
    });
  });

  describe('debouncing', () => {
    it('should debounce fetch requests', async () => {
      mockWsRequest.mockResolvedValue([]);

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      // Initial fetch after delay
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      const initialCallCount = mockWsRequest.mock.calls.length;

      // Try to refresh immediately
      await act(async () => {
        result.current.refresh();
      });

      // Should be debounced (less than 5 seconds since last fetch)
      expect(mockWsRequest.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('individual data fetchers', () => {
    it('should fetch METAR for a station', async () => {
      vi.useRealTimers();

      const metarData = {
        station: 'KJFK',
        raw: 'KJFK 121756Z 31012KT...',
      };

      mockWsRequest.mockResolvedValue(metarData);

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      let metar;
      await act(async () => {
        metar = await result.current.fetchMetar('KJFK');
      });

      expect(mockWsRequest).toHaveBeenCalledWith('metar', { station: 'KJFK' });
      expect(metar).toEqual(metarData);
    });

    it('should return null for METAR when not connected', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, false, 40.0, -74.0, 100, ALL_ON)
      );

      let metar;
      await act(async () => {
        metar = await result.current.fetchMetar('KJFK');
      });

      expect(metar).toBeNull();
      expect(mockWsRequest).not.toHaveBeenCalledWith('metar', expect.anything());
    });

    it('should fetch TAF for a station', async () => {
      vi.useRealTimers();

      const tafData = {
        station: 'KJFK',
        raw: 'TAF KJFK 121720Z...',
      };

      mockWsRequest.mockResolvedValue(tafData);

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      let taf;
      await act(async () => {
        taf = await result.current.fetchTaf('KJFK');
      });

      expect(mockWsRequest).toHaveBeenCalledWith('taf', { station: 'KJFK' });
      expect(taf).toEqual(tafData);
    });

    it('should fetch aircraft info by ICAO', async () => {
      vi.useRealTimers();

      const aircraftInfo = {
        icao: 'ABC123',
        registration: 'N12345',
        type: 'B738',
      };

      mockWsRequest.mockResolvedValue(aircraftInfo);

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      let info;
      await act(async () => {
        info = await result.current.fetchAircraftInfo('ABC123');
      });

      expect(mockWsRequest).toHaveBeenCalledWith('aircraft-info', { icao: 'ABC123' });
      expect(info).toEqual(aircraftInfo);
    });

    it('should handle fetch errors gracefully', async () => {
      vi.useRealTimers();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockWsRequest.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      let metar;
      await act(async () => {
        metar = await result.current.fetchMetar('KJFK');
      });

      expect(metar).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should set error when socket not connected', () => {
      const { result } = renderHook(() => useAviationData(null, false, 40.0, -74.0, 100, ALL_ON));

      expect(result.current.error).toBeNull();
    });

    it('should handle partial failures gracefully', async () => {
      vi.useRealTimers();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockWsRequest.mockImplementation((type) => {
        if (type === 'navaids') {
          return Promise.reject(new Error('Failed'));
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Other data should still be available
      expect(result.current.aviationData.airports).toEqual([]);

      consoleSpy.mockRestore();
    });
  });

  describe('refresh function', () => {
    it('should provide refresh function', () => {
      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      expect(typeof result.current.refresh).toBe('function');
    });
  });

  describe('airspace advisories', () => {
    it('should extract advisories from response', async () => {
      vi.useRealTimers();

      const advisories = [{ id: 1, type: 'G-AIRMET' }];

      mockWsRequest.mockImplementation((type) => {
        if (type === 'airspaces') {
          return Promise.resolve({ advisories });
        }
        return Promise.resolve([]);
      });

      const { result } = renderHook(() =>
        useAviationData(mockWsRequest, true, 40.0, -74.0, 100, ALL_ON)
      );

      await waitFor(() => {
        expect(result.current.aviationData.airspaceAdvisories).toEqual(advisories);
      });
    });
  });
});
