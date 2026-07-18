import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdvancedAnalyticsScreen } from './AdvancedAnalyticsScreen';
import {
  aircraftTypeRows,
  barsFrom,
  correlationStrength,
  crossDomainRows,
  heatColor,
  hourHeat,
  matrixGrid,
  militaryRows,
  routeRows,
  scatterGeometry,
} from './analyticsModel';

describe('analyticsModel', () => {
  it('scatterGeometry maps points into the plot rect', () => {
    const geo = scatterGeometry({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      slope: 1,
      intercept: 0,
    });
    expect(geo.empty).toBe(false);
    expect(geo.dots).toHaveLength(2);
    // first point maps to plot origin (left, bottom), second to (right, top)
    expect(geo.dots[0].cx).toBe(geo.plot.x0);
    expect(geo.dots[0].cy).toBe(geo.plot.y0);
    expect(geo.dots[1].cx).toBe(geo.plot.x1);
    expect(geo.reg).not.toBeNull();
  });

  it('scatterGeometry flags empty payloads', () => {
    expect(scatterGeometry({ points: [] }).empty).toBe(true);
    expect(scatterGeometry(undefined).empty).toBe(true);
  });

  it('correlationStrength labels magnitude and direction', () => {
    expect(correlationStrength(null).label).toBe('No data');
    expect(correlationStrength(0.85).label).toBe('strong positive');
    expect(correlationStrength(-0.85).label).toBe('strong negative');
    expect(correlationStrength(0.5).label).toBe('moderate positive');
    expect(correlationStrength(0.05).label).toBe('negligible');
  });

  it('heatColor differs by sign and is neutral for null', () => {
    expect(heatColor(null)).toBe('var(--bg2)');
    expect(heatColor(0.8)).toContain('--accent2');
    expect(heatColor(-0.8)).toContain('--danger');
  });

  it('matrixGrid builds a square grid with self diagonal', () => {
    const grid = matrixGrid({
      fields: [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta' },
      ],
      matrix: [
        [1, 0.5],
        [0.5, 1],
      ],
    });
    expect(grid).toHaveLength(2);
    expect(grid[0].cells).toHaveLength(2);
    expect(grid[0].cells[0].self).toBe(true);
    expect(grid[0].cells[1].r).toBe(0.5);
  });

  it('crossDomainRows computes activity and percentages', () => {
    const rows = crossDomainRows({
      aircraft: [
        { icao_hex: 'a1', alerts: 2, safety_events: 1, acars: 1, sightings: 10 },
        { icao_hex: 'a2', registration: 'N123', alerts: 0, safety_events: 0, acars: 0 },
      ],
    });
    expect(rows[0].activity).toBe(4);
    expect(rows[0].pct).toBe(100);
    expect(rows[0].label).toBe('A1');
    expect(rows[1].label).toBe('N123');
    expect(rows[1].pct).toBe(0);
  });

  it('barsFrom scales to the max value', () => {
    const bars = barsFrom(
      [
        { c: 'US', n: 10 },
        { c: 'CA', n: 5 },
      ],
      'c',
      'n'
    );
    expect(bars[0]).toEqual({ label: 'US', value: 10, pct: 100 });
    expect(bars[1].pct).toBe(50);
  });

  it('hourHeat returns 24 cells', () => {
    const cells = hourHeat([{ hour: 14, position_count: 100 }]);
    expect(cells).toHaveLength(24);
    expect(cells[14].count).toBe(100);
  });

  it('routeRows labels origin/destination pairs and falls back to airline code', () => {
    const rows = routeRows({
      routes: [
        {
          route_key: 'KJFK-KLAX',
          origin: 'KJFK',
          destination: 'KLAX',
          count: 10,
          sample_callsigns: ['AAL1'],
        },
        { route_key: 'DAL', airline_code: 'DAL', count: 5 },
      ],
    });
    expect(rows[0].label).toBe('KJFK → KLAX');
    expect(rows[0].pct).toBe(100);
    expect(rows[0].callsigns).toEqual(['AAL1']);
    expect(rows[1].label).toBe('DAL');
    expect(rows[1].pct).toBe(50);
    expect(rows[1].callsigns).toEqual([]);
  });

  it('aircraftTypeRows prefers type name and scales to sessions', () => {
    const rows = aircraftTypeRows({
      aircraft_types: [
        {
          type_code: 'B738',
          type_name: 'Boeing 737-800',
          session_count: 20,
          unique_aircraft: 8,
          military_pct: 0,
        },
        { type_code: 'C172', session_count: 5 },
      ],
    });
    expect(rows[0].name).toBe('Boeing 737-800');
    expect(rows[0].unique).toBe(8);
    expect(rows[0].pct).toBe(100);
    expect(rows[1].name).toBe('C172');
    expect(rows[1].pct).toBe(25);
  });

  it('militaryRows exposes counts and military share', () => {
    const rows = militaryRows({
      military_breakdown: [
        { country: 'USA', military_count: 3, civilian_count: 7, total: 10, military_pct: 30 },
        { country: 'UK', military_count: 1, civilian_count: 1, total: 2, military_pct: 50 },
      ],
    });
    expect(rows[0].country).toBe('USA');
    expect(rows[0].military).toBe(3);
    expect(rows[0].militaryPct).toBe(30);
    expect(rows[0].pct).toBe(100);
    expect(rows[1].pct).toBe(20);
  });

  it('new row helpers tolerate empty payloads', () => {
    expect(routeRows(undefined)).toEqual([]);
    expect(aircraftTypeRows({})).toEqual([]);
    expect(militaryRows(null)).toEqual([]);
  });
});

describe('AdvancedAnalyticsScreen', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      let body = {};
      if (url.includes('/analytics/scatter/')) {
        body = {
          x_field: 'distance_nm',
          y_field: 'rssi',
          n: 2,
          r: -0.98,
          slope: -1,
          intercept: 0,
          sampled: true,
          points: [
            { x: 1, y: -10 },
            { x: 2, y: -20 },
          ],
        };
      } else if (url.includes('/analytics/matrix/')) {
        body = {
          n: 2,
          sampled: false,
          fields: [
            { key: 'distance_nm', label: 'Distance' },
            { key: 'rssi', label: 'Signal (RSSI)' },
          ],
          matrix: [
            [1, -0.98],
            [-0.98, 1],
          ],
        };
      } else if (url.includes('/analytics/cross-domain/')) {
        body = {
          aircraft: [{ icao_hex: 'ABC123', alerts: 3, safety_events: 1, acars: 2, sightings: 40 }],
        };
      } else if (url.endsWith('/analytics/')) {
        body = { fields: [{ key: 'distance_nm', label: 'Distance', unit: 'nm' }] };
      } else if (url.includes('/flight-patterns/routes/')) {
        body = {
          routes: [
            {
              route_key: 'KJFK-KLAX',
              origin: 'KJFK',
              destination: 'KLAX',
              count: 12,
              sample_callsigns: ['AAL1'],
            },
          ],
          total_routes: 1,
        };
      } else if (url.includes('/flight-patterns/aircraft-types/')) {
        body = {
          aircraft_types: [
            {
              type_code: 'B738',
              type_name: 'Boeing 737-800',
              session_count: 9,
              unique_aircraft: 4,
              military_pct: 0,
            },
          ],
          total_types: 1,
        };
      } else if (url.includes('/geographic/military-breakdown/')) {
        body = {
          military_breakdown: [
            { country: 'USA', military_count: 2, civilian_count: 8, total: 10, military_pct: 20 },
          ],
        };
      } else if (url.includes('/flight-patterns/busiest-hours/')) {
        body = {
          busiest_hours: [{ hour: 9, position_count: 50, unique_aircraft: 12 }],
          peak_hour: 9,
          peak_aircraft_count: 12,
          day_positions: 400,
          night_positions: 100,
          day_night_ratio: 4,
        };
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(body),
      });
    });
  });

  const renderScreen = (props = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <AdvancedAnalyticsScreen apiBase="" onSelectAircraft={vi.fn()} {...props} />
      </QueryClientProvider>
    );
  };

  it('renders the header and explorer', () => {
    renderScreen();
    expect(screen.getByText('Advanced Analytics')).toBeInTheDocument();
    expect(screen.getByText('Correlation Explorer')).toBeInTheDocument();
  });

  it('shows the Pearson r once scatter loads', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('-0.980')).toBeInTheDocument());
  });

  it('opens an aircraft from the cross-domain table', async () => {
    const onSelect = vi.fn();
    renderScreen({ onSelectAircraft: onSelect });
    const row = await screen.findByText('ABC123');
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('ABC123');
  });

  it('renders the new frequent-routes, aircraft-types and military cards', async () => {
    renderScreen();
    expect(await screen.findByText('KJFK → KLAX')).toBeInTheDocument();
    expect(screen.getByText('Common Aircraft Types')).toBeInTheDocument();
    expect(await screen.findByText('Boeing 737-800')).toBeInTheDocument();
    expect(screen.getByText('Military vs Civilian by Country')).toBeInTheDocument();
    expect(await screen.findByText('USA')).toBeInTheDocument();
  });

  it('shows the sampled badge and day/night readout', async () => {
    renderScreen();
    // scatter payload is sampled -> at least one badge renders
    expect(await screen.findAllByText('Sampled')).not.toHaveLength(0);
    // busiest-hours day/night ratio
    expect(await screen.findByText(/4×/)).toBeInTheDocument();
  });
});
