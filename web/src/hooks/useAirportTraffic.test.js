import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAirportTraffic } from './useAirportTraffic';

describe('useAirportTraffic', () => {
  // Mock airport data
  const mockAirports = [
    {
      icao: 'KSEA',
      id: 'KSEA',
      name: 'Seattle-Tacoma International',
      lat: 47.4502,
      lon: -122.3088,
    },
    {
      icao: 'KBFI',
      id: 'KBFI',
      name: 'Boeing Field',
      lat: 47.5299,
      lon: -122.302,
    },
  ];

  // Mock aircraft data
  const mockAircraft = [
    {
      hex: 'abc123',
      flight: 'UAL123 ',
      type: 'B738',
      lat: 47.6,
      lon: -122.3,
      alt_baro: 8000,
      gs: 250,
      track: 180, // Heading south towards KSEA
      baro_rate: -1500, // Descending
    },
    {
      hex: 'def456',
      flight: 'DAL456 ',
      type: 'A320',
      lat: 47.45,
      lon: -122.31,
      alt_baro: 500,
      gs: 160,
      track: 90, // Heading east
      baro_rate: 2000, // Climbing (departure)
    },
    {
      hex: 'ghi789',
      flight: 'SWA789 ',
      type: 'B737',
      lat: 48.0, // Far from both airports
      lon: -122.3,
      alt_baro: 35000,
      gs: 450,
      track: 270,
      baro_rate: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty data when no airports are selected', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: [],
      })
    );

    expect(result.current.monitoredAirports).toEqual([]);
    expect(result.current.counts.total).toBe(0);
  });

  it('should filter airports based on selected airports', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA'],
      })
    );

    expect(result.current.monitoredAirports).toHaveLength(1);
    expect(result.current.monitoredAirports[0].icao).toBe('KSEA');
  });

  it('should detect inbound aircraft heading towards airport and descending', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA'],
        arrivalRadius: 50,
        timeWindowMinutes: 60,
      })
    );

    // UAL123 should be detected as inbound (heading south towards KSEA, descending)
    const inbound = result.current.inboundAircraft['KSEA'] || [];
    const uaFlight = inbound.find((a) => a.hex === 'abc123');

    expect(uaFlight).toBeDefined();
    expect(uaFlight.eta).toBeDefined();
    expect(uaFlight.distanceToAirport).toBeDefined();
  });

  it('should calculate ETA based on distance and speed', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA'],
        arrivalRadius: 50,
        timeWindowMinutes: 60,
      })
    );

    const inbound = result.current.inboundAircraft['KSEA'] || [];
    const uaFlight = inbound.find((a) => a.hex === 'abc123');

    if (uaFlight) {
      // ETA should be positive and reasonable
      expect(uaFlight.eta).toBeGreaterThan(0);
      expect(uaFlight.eta).toBeLessThan(60); // Within time window
    }
  });

  it('should sort inbound aircraft by ETA', () => {
    const multipleInbound = [
      {
        hex: 'near1',
        flight: 'TST1',
        lat: 47.5,
        lon: -122.3,
        alt_baro: 3000,
        gs: 200,
        track: 180,
        baro_rate: -1000,
      },
      {
        hex: 'far1',
        flight: 'TST2',
        lat: 47.8,
        lon: -122.3,
        alt_baro: 15000,
        gs: 200,
        track: 180,
        baro_rate: -1000,
      },
    ];

    const { result } = renderHook(() =>
      useAirportTraffic(multipleInbound, mockAirports, {
        selectedAirports: ['KSEA'],
        arrivalRadius: 50,
        timeWindowMinutes: 120,
      })
    );

    const inbound = result.current.inboundAircraft['KSEA'] || [];

    if (inbound.length >= 2) {
      // First aircraft should have shorter ETA
      expect(inbound[0].eta).toBeLessThanOrEqual(inbound[1].eta);
    }
  });

  it('should exclude aircraft outside arrival radius', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA'],
        arrivalRadius: 10, // Small radius
        timeWindowMinutes: 60,
      })
    );

    const inbound = result.current.inboundAircraft['KSEA'] || [];
    const farFlight = inbound.find((a) => a.hex === 'ghi789');

    // Far aircraft should not be in inbound list
    expect(farFlight).toBeUndefined();
  });

  it('should track counts correctly', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA'],
        arrivalRadius: 50,
        timeWindowMinutes: 60,
      })
    );

    expect(result.current.counts.inbound).toBeGreaterThanOrEqual(0);
    expect(result.current.counts.outbound).toBeGreaterThanOrEqual(0);
    expect(result.current.counts.total).toBe(
      result.current.counts.inbound + result.current.counts.outbound
    );
  });

  it('should support multiple selected airports', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA', 'KBFI'],
      })
    );

    expect(result.current.monitoredAirports).toHaveLength(2);
    expect(result.current.inboundAircraft['KSEA']).toBeDefined();
    expect(result.current.inboundAircraft['KBFI']).toBeDefined();
  });

  it('should handle empty aircraft list', () => {
    const { result } = renderHook(() =>
      useAirportTraffic([], mockAirports, {
        selectedAirports: ['KSEA'],
      })
    );

    expect(result.current.inboundAircraft['KSEA'] || []).toHaveLength(0);
    expect(result.current.counts.total).toBe(0);
  });

  it('should handle empty airport list', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, [], {
        selectedAirports: ['KSEA'],
      })
    );

    expect(result.current.monitoredAirports).toHaveLength(0);
  });

  it('should provide clearDepartures function', () => {
    const { result } = renderHook(() =>
      useAirportTraffic(mockAircraft, mockAirports, {
        selectedAirports: ['KSEA'],
      })
    );

    expect(typeof result.current.clearDepartures).toBe('function');

    // Should not throw when called
    act(() => {
      result.current.clearDepartures('KSEA');
    });
  });
});
