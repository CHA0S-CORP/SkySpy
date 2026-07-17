import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DetailScreen } from './DetailScreen';
import {
  externalLinks,
  flightStatus,
  miniSeries,
  projectTrack,
  transponderLog,
  trendOf,
} from './detailModel';

const LIVE = {
  hex: 'abbc52',
  flight: 'SWA3838 ',
  t: 'B738',
  alt: 1125,
  gs: 157,
  vr: -960,
  track: 286,
  distance_nm: 7.4,
  squawk: '4701',
  rssi: -4.2,
  lat: 33.0321,
  lon: -117.0982,
  seen: 0,
  r: 'N8512Z',
};

const TRACK = [
  {
    timestamp: '2026-07-16T04:40:00Z',
    lat: 33.2,
    lon: -116.8,
    altitude: 5200,
    gs: 240,
    vr: -600,
    squawk: '4701',
  },
  {
    timestamp: '2026-07-16T04:50:00Z',
    lat: 33.1,
    lon: -117.0,
    altitude: 3200,
    gs: 200,
    vr: -800,
    squawk: '4701',
  },
  {
    timestamp: '2026-07-16T05:00:00Z',
    lat: 33.03,
    lon: -117.1,
    altitude: 1125,
    gs: 157,
    vr: -960,
    squawk: '4701',
  },
];

describe('detailModel', () => {
  it('flightStatus derives ON APPROACH / CLIMBING / GROUND / EMERGENCY', () => {
    expect(flightStatus(LIVE).label).toBe('ON APPROACH');
    expect(flightStatus({ alt: 10000, vr: 1500 }).label).toBe('CLIMBING');
    expect(flightStatus({ alt: 0 }).label).toBe('ON GROUND');
    expect(flightStatus({ alt: 8000, vr: 0, squawk: '7700' }).label).toBe('EMERGENCY');
    expect(flightStatus(null).label).toBe('NOT TRACKING');
  });

  it('trendOf compares the last two samples', () => {
    expect(
      trendOf(TRACK, 'altitude', { upLabel: 'up', downLabel: 'down', flatLabel: 'flat' }).label
    ).toBe('down');
    expect(
      trendOf([], 'altitude', { upLabel: 'up', downLabel: 'down', flatLabel: 'flat' }).label
    ).toBe('flat');
  });

  it('projectTrack maps lat/lon into the viewBox with a marker accessor', () => {
    const proj = projectTrack(TRACK);
    expect(proj.count).toBe(3);
    expect(proj.points.split(' ')).toHaveLength(3);
    const start = proj.at(0);
    const end = proj.at(1);
    expect(start.x).not.toBe(end.x);
    expect(projectTrack([TRACK[0]])).toBeNull();
  });

  it('miniSeries builds a polyline with min/max', () => {
    const s = miniSeries(TRACK, 'altitude');
    expect(s.min).toBe(1125);
    expect(s.max).toBe(5200);
    expect(s.points.split(' ')).toHaveLength(3);
    expect(miniSeries([], 'altitude')).toBeNull();
  });

  it('transponderLog reports squawk + position milestones newest-first', () => {
    const log = transponderLog(TRACK);
    expect(log.length).toBeGreaterThan(0);
    expect(log.some((r) => r.msg.includes('Squawk'))).toBe(true);
    expect(log.some((r) => r.msg.includes('Position report'))).toBe(true);
  });

  it('externalLinks builds tracker URLs from identity', () => {
    const links = externalLinks({ hex: 'abbc52', callsign: 'SWA3838', registration: 'N8512Z' });
    expect(links.map((l) => l.label)).toEqual([
      'FlightAware',
      'ADSBexchange',
      'Flightradar24',
      'Planespotters',
    ]);
    expect(links[1].href).toContain('abbc52');
  });
});

describe('DetailScreen', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      const respond = (body) =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(body),
        });
      const u = String(url);
      if (u.includes('/airframes/'))
        return respond({
          registration: 'N8512Z',
          aircraft_type: 'B738',
          manufacturer: 'Boeing',
          model: '737-800',
          operator: 'Southwest Airlines',
          photo_url: 'https://example.com/p.jpg',
          photo_source: 'planespotters',
        });
      if (u.includes('/sightings')) return respond({ sightings: TRACK });
      if (u.includes('/safety/events')) return respond({ events: [] });
      if (u.includes('/sessions')) return respond({ sessions: [] });
      return respond({});
    });
  });

  const renderScreen = (props = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <DetailScreen
          apiBase=""
          hex="abbc52"
          live={LIVE}
          onClose={vi.fn()}
          onViewEvent={vi.fn()}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('renders identity bar with status pill and stat strip', async () => {
    renderScreen();
    expect(screen.getAllByText('SWA3838').length).toBeGreaterThan(0);
    expect(screen.getByText('ON APPROACH')).toBeInTheDocument();
    expect(screen.getByText('Mode-S ABBC52')).toBeInTheDocument();
    expect(screen.getByText('1,125')).toBeInTheDocument();
    expect(screen.getByText('4701')).toBeInTheDocument();
  });

  it('loads airframe info and external links', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Boeing')).toBeInTheDocument());
    expect(screen.getAllByText('Southwest Airlines').length).toBeGreaterThan(0);
    expect(screen.getByText('FlightAware')).toBeInTheDocument();
  });

  it('shows all-clear safety state and reception', async () => {
    renderScreen();
    await waitFor(() =>
      expect(screen.getByText(/ALL CLEAR — no safety events/)).toBeInTheDocument()
    );
    expect(screen.getByText('This station')).toBeInTheDocument();
  });

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    renderScreen({ onClose });
    fireEvent.click(screen.getByTestId('v2-detail-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the photo lightbox from the hero', async () => {
    renderScreen();
    // Enlarge badge appears once the photo URL has loaded
    await waitFor(() => expect(screen.getByText('Enlarge')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Enlarge aircraft photo'));
    expect(screen.getByAltText('SWA3838 aircraft')).toBeInTheDocument();
  });
});
