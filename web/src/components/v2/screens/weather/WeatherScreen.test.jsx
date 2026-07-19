import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the data hooks so the screen renders from fixtures.
vi.mock('../../../../hooks/useAviationData', () => ({
  useAviationData: () => ({
    aviationData: {
      metars: [{ icaoId: 'KLAX', rawOb: 'KLAX 010000Z 09014KT 10SM FEW250 23/14 A2990' }],
      pireps: [{ pirep_id: 'P1', location: 'LAX', turbType: 'MOD', altFt: 35000 }],
    },
  }),
}));
vi.mock('../../../../hooks/useAirspaceAdvisories', () => ({
  useAirspaceAdvisories: () => ({
    advisories: [
      {
        advisory_id: 'T1',
        hazard: 'TURB-HI',
        severity: 'MOD',
        lower_alt_ft: 18000,
        upper_alt_ft: 42000,
      },
    ],
  }),
}));
// Leaflet can't mount in jsdom — stub the map.
vi.mock('./WeatherMap', () => ({ WeatherMap: () => <div data-testid="wx-map" /> }));
// usePointTurbulence polls an endpoint; stub the sector readout.
vi.mock('../../../../hooks/usePointTurbulence', async (orig) => ({
  ...(await orig()),
  usePointTurbulence: () => ({
    level: 'none',
    score: 0,
    gairmet: [],
    pireps: [],
    winds: null,
    loading: false,
  }),
}));
// useAircraftTurbulence polls the scorer; stub with an empty map (fixtures
// already carry turbulenceLevel).
vi.mock('../../../../hooks/useAircraftTurbulence', () => ({
  useAircraftTurbulence: () => ({ byHex: new Map(), loading: false, error: null }),
}));

import { WeatherScreen } from './WeatherScreen';

const AC = [
  { hex: 'A', flight: 'UAL1', turbulenceLevel: 'severe', turbulenceRisk: 80, alt_baro: 35000 },
  { hex: 'B', turbulenceLevel: 'moderate', turbulenceRisk: 50 },
];

describe('WeatherScreen', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders KPIs and the at-risk list', () => {
    render(<WeatherScreen apiBase="" aircraft={AC} feederLocation={{ lat: 34, lon: -118 }} />);
    expect(screen.getByText('Weather & Turbulence')).toBeInTheDocument();
    expect(screen.getByText('a/c at risk')).toBeInTheDocument();
    // The severe aircraft callsign is a clickable link.
    expect(screen.getByText('UAL1')).toBeInTheDocument();
  });

  it('navigates on aircraft click', () => {
    const onSelectAircraft = vi.fn();
    render(
      <WeatherScreen
        apiBase=""
        aircraft={AC}
        feederLocation={{ lat: 34, lon: -118 }}
        onSelectAircraft={onSelectAircraft}
      />
    );
    fireEvent.click(screen.getByText('UAL1'));
    expect(onSelectAircraft).toHaveBeenCalledWith('A');
  });

  it('switches sub-tabs', () => {
    render(<WeatherScreen apiBase="" aircraft={AC} feederLocation={{ lat: 34, lon: -118 }} />);
    fireEvent.click(screen.getByRole('button', { name: /PIREPs/ }));
    expect(screen.getByText(/Pilot Reports/)).toBeInTheDocument();
  });
});
