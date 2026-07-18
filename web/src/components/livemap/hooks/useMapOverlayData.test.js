import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock the underlying data hooks so we can drive the assembly deterministically.
const mockTrack = vi.fn();
const mockAviation = vi.fn();
const mockNotams = vi.fn();

vi.mock('../../../hooks/useTrackHistory', () => ({
  useTrackHistory: (...args) => mockTrack(...args),
}));
vi.mock('../../../hooks/useAviationData', () => ({
  useAviationData: (...args) => mockAviation(...args),
}));
vi.mock('../../../hooks/useNotams', () => ({
  useNotams: (...args) => mockNotams(...args),
}));

import { useMapOverlayData } from './useMapOverlayData';

const NOTAM = { notam_id: 'N1', type: 'D', latitude: 33, longitude: -117 };
const TFR = { notam_id: 'T1', type: 'TFR', latitude: 34, longitude: -118, radius_nm: 5 };
const PIREP = { id: 1, lat: 32.5, lon: -117.5, turbulence: 'MOD' };

const feeder = { lat: 32.8, lon: -117.2 };

function setup(overlays) {
  return renderHook(() =>
    useMapOverlayData({
      wsRequest: () => {},
      wsConnected: true,
      feeder,
      aircraft: [],
      overlays,
    })
  );
}

describe('useMapOverlayData', () => {
  beforeEach(() => {
    mockTrack.mockReturnValue({ trackHistory: { ABC: [{}, {}] } });
    mockAviation.mockReturnValue({
      aviationData: {
        navaids: [{ ident: 'VOR', lat: 1, lon: 2 }],
        airports: [{ icao: 'KSAN', lat: 1, lon: 2 }],
        airspace: [{ name: 'B', polygon: {} }],
        pireps: [PIREP],
      },
    });
    mockNotams.mockReturnValue({ notams: [NOTAM, TFR] });
  });

  it('splits the merged NOTAM list into plain notams and TFRs when notams overlay on', () => {
    const { result } = setup({ notams: true });
    expect(result.current.notams).toEqual([NOTAM]);
    expect(result.current.tfrs).toEqual([TFR]);
  });

  it('drops notams + tfrs when the overlay is off', () => {
    const { result } = setup({ notams: false });
    expect(result.current.notams).toEqual([]);
    expect(result.current.tfrs).toEqual([]);
  });

  it('includes pireps only when the pireps overlay is on', () => {
    const off = setup({ pireps: false });
    expect(off.result.current.pireps).toEqual([]);
    const on = setup({ pireps: true });
    expect(on.result.current.pireps).toEqual([PIREP]);
  });

  it('gates navaids/airports/airspace/trails on their toggles', () => {
    const { result } = setup({ navaids: true, airports: false, airspace: true, trails: true });
    expect(result.current.navaids).toHaveLength(1);
    expect(result.current.airports).toEqual([]);
    expect(result.current.airspaces).toHaveLength(1);
    expect(result.current.trails).toEqual({ ABC: [{}, {}] });
  });

  it('returns empty arrays (never undefined) for every layer with empty overlays', () => {
    const { result } = setup({});
    expect(result.current.navaids).toEqual([]);
    expect(result.current.airports).toEqual([]);
    expect(result.current.airspaces).toEqual([]);
    expect(result.current.notams).toEqual([]);
    expect(result.current.tfrs).toEqual([]);
    expect(result.current.pireps).toEqual([]);
    expect(result.current.trails).toEqual({});
  });
});
