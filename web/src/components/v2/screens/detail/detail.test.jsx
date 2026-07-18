import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// DetailTrackMap renders a real Leaflet map, which crashes in jsdom (no layout).
// Mock vanilla leaflet with chainable no-ops for this file only (a global alias
// would break livemap.test.jsx, which exercises real Leaflet).
vi.mock('leaflet', async () => await import('../../../../test/mocks/leaflet.js'));

import { DetailScreen } from './DetailScreen';
import {
  countryCodeToFlag,
  externalLinks,
  flightStatus,
  miniSeries,
  projectTrack,
  transponderLog,
  trendOf,
} from './detailModel';
import { isPopulatedAirframe } from './useDetailData';

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

  it('isPopulatedAirframe distinguishes a cold record from a real one', () => {
    expect(isPopulatedAirframe(null)).toBe(false);
    expect(isPopulatedAirframe({})).toBe(false);
    // Cold row: only icao_hex/is_military, everything else null.
    expect(
      isPopulatedAirframe({ icao_hex: 'ABC123', is_military: false, registration: null })
    ).toBe(false);
    expect(isPopulatedAirframe({ registration: 'N8512Z' })).toBe(true);
    expect(isPopulatedAirframe({ manufacturer: 'Boeing' })).toBe(true);
    // Empty strings are not "populated".
    expect(isPopulatedAirframe({ operator: '' })).toBe(false);
  });

  it('countryCodeToFlag maps a valid alpha-2 code to regional-indicator emoji', () => {
    expect(countryCodeToFlag('US')).toBe('\u{1F1FA}\u{1F1F8}');
    expect(countryCodeToFlag('gb')).toBe('\u{1F1EC}\u{1F1E7}');
    // trims + case-insensitive
    expect(countryCodeToFlag(' de ')).toBe('\u{1F1E9}\u{1F1EA}');
  });

  it('countryCodeToFlag returns "" for absent/invalid codes', () => {
    expect(countryCodeToFlag(null)).toBe('');
    expect(countryCodeToFlag(undefined)).toBe('');
    expect(countryCodeToFlag('')).toBe('');
    expect(countryCodeToFlag('U')).toBe('');
    expect(countryCodeToFlag('USA')).toBe('');
    expect(countryCodeToFlag('U1')).toBe('');
    expect(countryCodeToFlag(42)).toBe('');
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
          country_code: 'US',
          country: 'United States',
          aircraft_type: 'B738',
          manufacturer: 'Boeing',
          model: '737-800',
          operator: 'Southwest Airlines',
          photo_url: 'https://example.com/p.jpg',
          photo_source: 'planespotters',
          year_built: 2012,
          age_years: 14,
          airframe_hours: 41200,
          first_flight_date: '2012-03-01',
          delivery_date: '2012-04-15',
          cached_at: '2026-07-16T05:00:00Z',
          fetch_failed: false,
          owner_type: 'llc',
          is_shell_suspected: true,
          shell_score: 0.82,
          ownership_flags: {
            risk_level: 'high',
            factors: { po_box_address: 0.1, registered_agent_address: 0.25 },
            details: { po_box_detected: true },
          },
          dossier_text:
            'N8512Z is a Boeing 737-800 registered to a Delaware LLC with a PO box address.',
          matched_radio_calls: [
            {
              id: 9,
              created_at: '2026-07-16T05:01:00Z',
              transcript: 'Southwest 3838 descend and maintain one two thousand',
              frequency_mhz: 124.35,
              duration_seconds: 3.2,
              confidence: 0.91,
            },
          ],
          source_data: [
            {
              source: 'faa',
              registration: 'N8512Z',
              is_ladd: true,
              is_pia: false,
              is_military: false,
              fetched_at: '2026-07-16T04:00:00Z',
            },
            {
              source: 'adsbx',
              registration: 'N8512Z',
              is_ladd: false,
              is_pia: true,
              is_interesting: true,
              fetched_at: '2026-07-16T04:30:00Z',
            },
          ],
        });
      if (u.includes('/sightings')) return respond({ sightings: TRACK });
      if (u.includes('/safety/events')) return respond({ events: [] });
      if (u.includes('/sessions')) return respond({ sessions: [] });
      if (u.includes('/lookup/route/'))
        return respond({
          callsign: 'SWA3838',
          route: {
            origin: { iata: 'LAX', icao: 'KLAX', city: 'Los Angeles' },
            destination: { iata: 'PHX', icao: 'KPHX', city: 'Phoenix' },
          },
        });
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

  it('shows a country-flag emoji next to the registration chip', async () => {
    renderScreen();
    const flag = await screen.findByTestId('v2-detail-reg-flag');
    expect(flag).toHaveTextContent('\u{1F1FA}\u{1F1F8}');
    expect(flag).toHaveAttribute('aria-label', 'United States flag');
    expect(flag).toHaveAttribute('title', 'United States');
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

  it('renders the flight route card from origin/destination airports', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Flight Route')).toBeInTheDocument());
    // LAX/PHX now appear twice: the top-of-page summary + the full route card.
    expect(screen.getAllByText('LAX').length).toBeGreaterThan(0);
    expect(screen.getByText('Los Angeles')).toBeInTheDocument();
    expect(screen.getAllByText('PHX').length).toBeGreaterThan(0);
  });

  it('falls back to the call prop for the callsign when not live', async () => {
    // No live entry: callsign (and the route lookup it enables) must come from
    // the route param instead.
    renderScreen({ live: undefined, call: 'SWA3838' });
    await waitFor(() => expect(screen.getByText('Flight Route')).toBeInTheDocument());
    expect(screen.getAllByText('SWA3838').length).toBeGreaterThan(0);
  });

  it('shows a compact route summary at the top of the page', async () => {
    const { container } = renderScreen();
    await waitFor(() => expect(container.querySelector('.v2-det__route-mini')).not.toBeNull());
    const mini = container.querySelector('.v2-det__route-mini');
    expect(mini.textContent).toContain('LAX');
    expect(mini.textContent).toContain('PHX');
  });

  it('shows the map LIVE indicator when connected with a live position', () => {
    renderScreen({ connected: true });
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows OFFLINE on the map when the socket is down', () => {
    renderScreen({ connected: false });
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('pauses live tracking when the toggle is switched off', () => {
    renderScreen({ connected: true });
    fireEvent.click(screen.getByLabelText('Live tracking'));
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
  });

  it('surfaces privacy/interest flags aggregated across source_data', async () => {
    const { container } = renderScreen();
    // LADD from the FAA source, PIA + INTERESTING from the adsbx source, OR'd
    // together into identity-bar badges.
    await waitFor(() => expect(container.querySelector('.v2-det__flag--ladd')).not.toBeNull());
    expect(container.querySelector('.v2-det__flag--pia')).not.toBeNull();
    expect(container.querySelector('.v2-det__flag--interesting')).not.toBeNull();
    // INTERESTING only appears as an identity badge (no source-tag equivalent).
    expect(screen.getByText('INTERESTING')).toBeInTheDocument();
  });

  it('renders airframe age, hours and history dates', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('14 yrs')).toBeInTheDocument());
    expect(screen.getByText('41,200 h')).toBeInTheDocument();
    expect(screen.getByText('First Flight')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
  });

  it('shows the freshness footer with the cached timestamp', async () => {
    const { container } = renderScreen();
    await waitFor(() => expect(container.querySelector('.v2-det__freshness')).not.toBeNull());
    expect(container.querySelector('.v2-det__freshness-cached').textContent).toMatch(/cached/);
  });

  it('renders the Data Sources card from source_data', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Data Sources')).toBeInTheDocument());
    expect(screen.getByText('FAA')).toBeInTheDocument();
    expect(screen.getByText('ADSBX')).toBeInTheDocument();
    expect(screen.getByText('2 reporting')).toBeInTheDocument();
  });

  it('renders the Radio Activity card from matched_radio_calls', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Radio Activity')).toBeInTheDocument());
    expect(screen.getByText(/Southwest 3838 descend/)).toBeInTheDocument();
    expect(screen.getByText('124.350 MHz')).toBeInTheDocument();
    expect(screen.getByText('91% match')).toBeInTheDocument();
  });

  it('omits the Radio Activity card when no calls are matched', async () => {
    global.fetch = vi.fn((url) => {
      const respond = (body) =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(body),
        });
      const u = String(url);
      if (u.includes('/airframes/'))
        return respond({ registration: 'N8512Z', manufacturer: 'Boeing' });
      if (u.includes('/sightings')) return respond({ sightings: TRACK });
      if (u.includes('/safety/events')) return respond({ events: [] });
      if (u.includes('/sessions')) return respond({ sessions: [] });
      return respond({});
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Boeing')).toBeInTheDocument());
    expect(screen.queryByText('Radio Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Data Sources')).not.toBeInTheDocument();
    // Neither ownership nor summary cards without their fields.
    expect(screen.queryByTestId('v2-detail-ownership')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v2-detail-summary')).not.toBeInTheDocument();
  });

  it('renders the Summary card from dossier_text', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-detail-summary')).toBeInTheDocument());
    expect(screen.getByTestId('v2-detail-summary-text').textContent).toMatch(
      /registered to a Delaware LLC/
    );
  });

  it('renders the Ownership Analysis card with shell flag, score bar and factors', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-detail-ownership')).toBeInTheDocument());
    expect(screen.getByTestId('v2-detail-ownership-type').textContent).toBe('LLC');
    expect(screen.getByTestId('v2-detail-shell-flag').textContent).toMatch(
      /Shell company suspected/
    );
    expect(screen.getByTestId('v2-detail-shell-score').textContent).toMatch(/82%/);
    // Risk level pill from ownership_flags.risk_level.
    expect(screen.getByTestId('v2-detail-ownership-risk').textContent).toMatch(/HIGH/);
    // Evidence: weighted factors (object shape {key: weight}) rendered with their
    // percent contribution, sorted by weight (registered-agent 25% before PO box 10%).
    const factors = screen.getByTestId('v2-detail-ownership-factors');
    expect(factors.textContent).toMatch(/Registered-agent address/);
    expect(factors.textContent).toMatch(/\+25%/);
    expect(factors.textContent).toMatch(/PO box address/);
    expect(factors.textContent).toMatch(/\+10%/);
  });

  it('shows a clear ownership state when not suspected', async () => {
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
          manufacturer: 'Boeing',
          owner_type: 'individual',
          is_shell_suspected: false,
          shell_score: 0.05,
          ownership_flags: null,
        });
      if (u.includes('/sightings')) return respond({ sightings: TRACK });
      if (u.includes('/safety/events')) return respond({ events: [] });
      if (u.includes('/sessions')) return respond({ sessions: [] });
      return respond({});
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-detail-ownership')).toBeInTheDocument());
    expect(screen.getByTestId('v2-detail-shell-flag').textContent).toMatch(
      /No shell-company indicators/
    );
    expect(screen.getByTestId('v2-detail-ownership-type').textContent).toBe('Individual');
    // No factors block when ownership_flags is null.
    expect(screen.queryByTestId('v2-detail-ownership-factors')).not.toBeInTheDocument();
  });
});
