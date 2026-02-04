import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock the utility modules before importing the hook
vi.mock('../utils/lawEnforcement', () => ({
  identifyLawEnforcement: vi.fn(() => ({
    isLawEnforcement: false,
    isHelicopter: false,
    isSurveillanceType: false,
    isInterest: false,
    category: null,
    description: null,
    confidence: 'none',
  })),
  getThreatLevel: vi.fn(() => 'info'),
  calculateDistanceNm: vi.fn(() => 5),
  calculateBearing: vi.fn(() => 45),
  getDirectionName: vi.fn(() => 'NE'),
}));

vi.mock('../utils/threatPrediction', () => ({
  calculateClosingSpeed: vi.fn(() => 150),
  calculateETA: vi.fn(() => ({
    eta: null,
    cpaDistance: 5,
    willIntercept: false,
  })),
  calculateUrgencyScore: vi.fn(() => 50),
  detectCirclingBehavior: vi.fn(() => ({
    isCircling: false,
    confidence: 0,
  })),
  detectLoitering: vi.fn(() => ({
    isLoitering: false,
    duration: 0,
  })),
}));

import { useThreatCalculation } from './useThreatCalculation';

describe('useThreatCalculation', () => {
  const defaultSettings = {
    voiceEnabled: false,
    hapticEnabled: false,
    persistent: false,
    useBackend: false,
    threatRadius: 50,
    altitudeFloor: 0,
    altitudeCeiling: 60000,
    ignoreAboveAltitude: 60000,
    showLawEnforcementOnly: false,
    showAllHelicopters: true,
    detectCircling: false,
    detectLoitering: false,
    loiterThreshold: 10,
    whitelistedHexes: [],
  };

  const defaultPosition = { lat: 40.0, lon: -74.0 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty threats array initially', () => {
    const { result } = renderHook(() =>
      useThreatCalculation({
        aircraft: [],
        position: defaultPosition,
        settings: defaultSettings,
      })
    );

    expect(result.current.threats).toEqual([]);
    expect(result.current.threatCount).toBe(0);
  });

  it('should use backend threats when provided', () => {
    const backendThreats = [
      {
        icao_hex: 'ABC123',
        callsign: 'TEST1',
        distance_nm: 3.5,
        threat_level: 'warning',
        lat: 40.05,
        lon: -74.05,
      },
    ];

    const { result } = renderHook(() =>
      useThreatCalculation({
        aircraft: [],
        position: defaultPosition,
        settings: { ...defaultSettings, useBackend: true },
        backendThreats,
        backendConnected: true,
      })
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.threats.length).toBe(1);
    expect(result.current.threats[0].hex).toBe('ABC123');
  });
});
