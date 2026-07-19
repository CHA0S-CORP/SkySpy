import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryScreen } from './HistoryScreen';
import {
  activityBins,
  airlineOf,
  categoryOfSession,
  fmtCoord,
  fmtSpeedTrack,
  historyKpis,
  historyStatRows,
  selectSessions,
  toSessionCard,
} from './historyModel';
import { adaptNotamStats, normalizeNotam } from './ArchiveTab';

const S1 = {
  id: 1,
  icao_hex: 'AB1FB0',
  callsign: 'ASA518',
  type: 'B38M',
  duration_min: 29,
  positions: 340,
  max_alt: 32000,
  min_distance_nm: 61.0,
  max_distance_nm: 143.7,
  max_vr: 2176,
  min_rssi: -21,
  max_rssi: -6,
  first_seen: '2026-07-16T09:53:07Z',
  last_seen: '2026-07-16T10:22:22Z',
};
const S2 = {
  id: 2,
  icao_hex: 'ADF2B7',
  callsign: 'RCH471',
  type: 'C17',
  duration_min: 19,
  positions: 190,
  max_alt: 12000,
  min_distance_nm: 22,
  max_distance_nm: 120,
  max_vr: 1920,
  max_rssi: -14,
  is_military: true,
  first_seen: '2026-07-16T10:03:00Z',
  last_seen: '2026-07-16T10:22:22Z',
};

describe('historyModel', () => {
  it('categoryOfSession and airlineOf classify sessions', () => {
    expect(categoryOfSession(S2)).toBe('military');
    expect(categoryOfSession(S1)).toBe('commercial');
    expect(airlineOf(S1)).toBe('Alaska');
    expect(airlineOf(S2)).toBe('Military');
  });

  it('toSessionCard derives display fields', () => {
    const card = toSessionCard(S1, new Map());
    expect(card.cs).toBe('ASA518');
    expect(card.altk).toBe('32k');
    expect(card.dMax).toBe('143.7');
    expect(card.vs).toBe('+2176');
    expect(card.db).toBe(-6);
    expect(card.dbMin).toBe(-21);
    expect(card.hasSafety).toBe(false);
    // min_rssi is optional — absent leaves dbMin null
    expect(toSessionCard(S2, new Map()).dbMin).toBeNull();
    const withSafety = toSessionCard(S2, new Map([['ADF2B7', 3]]));
    expect(withSafety.hasSafety).toBe(true);
    expect(withSafety.accent).toBe('var(--warn)');
  });

  it('selectSessions filters and sorts', () => {
    const all = [S1, S2];
    expect(selectSessions(all, { query: 'rch' })).toEqual([S2]);
    expect(selectSessions(all, { mil: true })).toEqual([S2]);
    expect(selectSessions(all, { cat: 'Commercial' })).toEqual([S1]);
    const byDur = selectSessions(all, { sortBy: 'duration', sortDir: 'desc' });
    expect(byDur[0]).toEqual(S1);
  });

  it('historyKpis aggregates', () => {
    const k = historyKpis([S1, S2], 5);
    expect(k.sessions).toBe(2);
    expect(k.aircraft).toBe(2);
    expect(k.avgDur).toBe(24);
    expect(k.maxRange).toBe(144);
    expect(k.safety).toBe(5);
  });

  it('activityBins returns 48 bins', () => {
    const bins = activityBins([S1, S2], 24);
    expect(bins).toHaveLength(48);
  });

  it('fmtSpeedTrack renders speed and 3-digit padded heading, guarding absent halves', () => {
    expect(fmtSpeedTrack(180, 45)).toBe('180 kt @ 045°');
    expect(fmtSpeedTrack(180, null)).toBe('180 kt');
    expect(fmtSpeedTrack(null, 45)).toBe('@ 045°');
    expect(fmtSpeedTrack(null, null)).toBeNull();
    expect(fmtSpeedTrack(undefined, undefined)).toBeNull();
    expect(fmtSpeedTrack(180, 360)).toBe('180 kt @ 000°');
  });

  it('fmtCoord formats present pairs and skips partial ones', () => {
    expect(fmtCoord(47.6205, -122.3493)).toBe('47.6205, -122.3493');
    expect(fmtCoord(null, -122.3)).toBeNull();
    expect(fmtCoord(47.6, undefined)).toBeNull();
  });

  it('historyStatRows only emits rows for numeric fields present', () => {
    const rows = historyStatRows({
      total_sightings: 1240,
      unique_aircraft: 88,
      max_altitude: 41000,
      avg_distance_nm: 62.4,
      max_speed: null,
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['TOTAL SIGHTINGS'].value).toBe(1240);
    expect(byLabel['MAX ALTITUDE'].unit).toBe('ft');
    expect(byLabel['AVG DISTANCE'].value).toBe(62.4);
    // null / absent fields produce no row
    expect(byLabel['MAX SPEED']).toBeUndefined();
    expect(byLabel['TOTAL SESSIONS']).toBeUndefined();
    expect(historyStatRows(undefined)).toEqual([]);
  });
});

describe('HistoryScreen', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      const respond = (body) =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(body),
        });
      const u = String(url);
      if (u.includes('/history/stats'))
        return respond({
          total_sightings: 1240,
          total_sessions: 96,
          unique_aircraft: 88,
          military_sessions: 4,
          max_altitude: 41000,
          avg_distance_nm: 62.4,
        });
      if (u.includes('/sightings'))
        return respond({
          sightings: [
            {
              id: 71,
              icao_hex: 'AB1FB0',
              callsign: 'ASA518',
              altitude: 32000,
              gs: 180,
              track: 45,
              lat: 47.62,
              lon: -122.35,
              is_emergency: false,
              timestamp: '2026-07-16T10:22:22Z',
            },
            {
              id: 72,
              icao_hex: 'ADF2B7',
              callsign: 'RCH471',
              altitude: 12000,
              gs: null,
              track: null,
              is_emergency: true,
              timestamp: '2026-07-16T10:23:00Z',
            },
          ],
        });
      if (u.includes('/sessions')) return respond({ sessions: [S1, S2] });
      if (u.includes('/safety/events'))
        return respond({ events: [{ id: 9, icao_hex: 'ADF2B7', event_type: 'EMERGENCY_SQUAWK' }] });
      if (u.includes('/aviation/pireps'))
        return respond({
          data: [
            {
              id: 5,
              location: 'SEA',
              report_type: 'UUA',
              observation_time: '2026-07-16T10:10:00Z',
              flight_level: 350,
              turbulence_type: 'MOD',
              turbulence_base_ft: 30000,
              turbulence_top_ft: 36000,
              severity: 'moderate',
              human_summary: 'Moderate turbulence FL350 near SEA',
              decoded: {
                turbulence: { level: 3, label: 'Moderate', code: 'MOD' },
                icing: null,
                wind_shear: null,
                severity: 'caution',
                human_summary: 'Moderate turbulence FL350 near SEA',
                hazards: [],
              },
            },
          ],
        });
      if (u.includes('/notams/stats'))
        return respond({
          total_notams: 3,
          active_notams: 2,
          active_tfrs: 1,
          by_type: { D: 2, TFR: 1 },
          last_refresh: '2026-07-16T10:00:00Z',
        });
      if (u.includes('/notams/tfrs'))
        return respond({
          tfrs: [
            {
              notam_id: 'TFR-1',
              location: 'KSEA',
              reason: 'VIP movement',
              floor_ft: 0,
              ceiling_ft: 3000,
              effective_start: '2026-07-16T09:00:00Z',
              effective_end: '2026-07-16T12:00:00Z',
            },
          ],
        });
      if (u.includes('/notams/airport/KSEA'))
        return respond({
          notams: [
            {
              notam_id: 'KSEA-A001',
              notam_type: 'D',
              location: 'KSEA',
              text: 'RWY 16L/34R CLSD',
              effective_start: '2026-07-16T00:00:00Z',
            },
          ],
        });
      if (u.includes('/archive/pireps'))
        return respond({
          pireps: [
            {
              pirep_id: 'arch-1',
              location: 'KSEA',
              report_type: 'UA',
              observation_time: '2026-07-16T10:00:00Z',
              aircraft_type: 'B738',
              raw_text: 'SEA UA /OV SEA /RM SMOOTH',
            },
          ],
        });
      if (u.includes('/notams/'))
        return respond({
          notams: [
            {
              notam_id: 'GEN-001',
              notam_type: 'FDC',
              location: 'ZSE',
              text: 'GPS unreliable in ARTCC',
              effective_start: '2026-07-16T00:00:00Z',
            },
          ],
        });
      return respond([]);
    });
  });

  const renderScreen = (props = {}) => {
    // The active tab is now deep-linked via the URL (#history?data=…) rather
    // than a prop, so translate the test's `hashParams` into the hash.
    const { hashParams, ...rest } = props;
    if (hashParams?.data) window.location.hash = `#history?data=${hashParams.data}`;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <HistoryScreen apiBase="" onSelectAircraft={vi.fn()} onViewEvent={vi.fn()} {...rest} />
      </QueryClientProvider>
    );
  };

  it('renders session cards with KPIs', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-hist-card-AB1FB0')).toBeInTheDocument());
    expect(screen.getByText('ASA518')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 sessions')).toBeInTheDocument();
  });

  it('military toggle filters cards', async () => {
    renderScreen();
    await waitFor(() => screen.getByTestId('v2-hist-card-AB1FB0'));
    fireEvent.click(screen.getByRole('button', { name: 'Military' }));
    expect(screen.queryByTestId('v2-hist-card-AB1FB0')).toBeNull();
    expect(screen.getByTestId('v2-hist-card-ADF2B7')).toBeInTheDocument();
  });

  it('safety badge appears from safety events cross-reference', async () => {
    renderScreen();
    await waitFor(() => screen.getByTestId('v2-hist-card-ADF2B7'));
    const card = screen.getByTestId('v2-hist-card-ADF2B7');
    expect(card.querySelector('.v2-hist__card-safety')).toBeTruthy();
  });

  it('card click navigates to aircraft detail', async () => {
    const onSelect = vi.fn();
    renderScreen({ onSelectAircraft: onSelect });
    await waitFor(() => screen.getByTestId('v2-hist-card-AB1FB0'));
    fireEvent.click(screen.getByTestId('v2-hist-card-AB1FB0'));
    expect(onSelect).toHaveBeenCalledWith('ab1fb0');
  });

  it('deep-links to a tab via hashParams and shows empty state', async () => {
    renderScreen({ hashParams: { data: 'acars' } });
    await waitFor(() =>
      expect(screen.getByText('No ACARS messages in this window')).toBeInTheDocument()
    );
  });

  it('renders the history stats summary panel from /history/stats', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('v2-hist-stats')).toBeInTheDocument());
    const panel = screen.getByTestId('v2-hist-stats');
    expect(panel).toHaveTextContent('UNIQUE AIRCRAFT');
    expect(panel).toHaveTextContent('88');
    expect(panel).toHaveTextContent('MAX ALTITUDE');
    expect(panel).toHaveTextContent('41,000');
  });

  it('session card shows min-to-max signal range', async () => {
    renderScreen();
    const card = await screen.findByTestId('v2-hist-card-AB1FB0');
    expect(card).toHaveTextContent('-21 to -6 dB');
  });

  it('PIREP tab surfaces report type, severity and met summary', async () => {
    renderScreen({ hashParams: { data: 'pireps' } });
    await waitFor(() =>
      expect(screen.getByText('Moderate turbulence FL350 near SEA')).toBeInTheDocument()
    );
    expect(screen.getByText('UUA')).toBeInTheDocument();
    expect(screen.getByText('moderate')).toBeInTheDocument();
  });

  it('sightings tab renders speed @ track and guards absent track', async () => {
    renderScreen({ hashParams: { data: 'sightings' } });
    const rows = await screen.findAllByTestId('v2-hist-sighting');
    expect(rows).toHaveLength(2);
    // present gs + track -> "180 kt @ 045°"
    expect(rows[0]).toHaveTextContent('180 kt @ 045°');
    // absent gs + track -> no speed/track fragment, no crash
    expect(rows[1]).not.toHaveTextContent('kt');
    expect(rows[1]).not.toHaveTextContent('@');
  });

  it('emergency sighting shows red badge and highlights the row', async () => {
    renderScreen({ hashParams: { data: 'sightings' } });
    const rows = await screen.findAllByTestId('v2-hist-sighting');
    // non-emergency: no badge, no highlight
    expect(rows[0].querySelector('[data-testid="v2-hist-sighting-emergency"]')).toBeNull();
    expect(rows[0].className).not.toContain('v2-hist__row--emergency');
    // emergency: badge + highlight
    const badge = screen.getByTestId('v2-hist-sighting-emergency');
    expect(badge).toHaveTextContent('EMERGENCY');
    expect(rows[1]).toContainElement(badge);
    expect(rows[1].className).toContain('v2-hist__row--emergency');
  });

  it('archive tab renders NOTAM stats, TFR/NOTAM cards and PIREP viz', async () => {
    renderScreen({ hashParams: { data: 'archive' } });
    await waitFor(() => expect(screen.getByTestId('v2-history-archive')).toBeInTheDocument());
    // NotamStats header (adapted from active_notams / active_tfrs)
    await waitFor(() => expect(screen.getByText('Active NOTAMs')).toBeInTheDocument());
    expect(screen.getByText('Active TFRs')).toBeInTheDocument();
    // TFR card from /notams/tfrs
    await waitFor(() => expect(screen.getByTestId('v2-arch-tfrs')).toBeInTheDocument());
    expect(screen.getByText('TFR-1')).toBeInTheDocument();
    // General NOTAM card from /notams/
    expect(screen.getByText('GEN-001')).toBeInTheDocument();
    // PIREP viz reuses the pirep components + summary
    const pireps = await screen.findAllByTestId('v2-arch-pirep');
    expect(pireps.length).toBeGreaterThan(0);
    expect(screen.getByText('Moderate turbulence FL350 near SEA')).toBeInTheDocument();
  });

  it('archive airport search switches to airport + archive endpoints', async () => {
    renderScreen({ hashParams: { data: 'archive' } });
    // wait for the initial (unfiltered) load to settle so the search button
    // is no longer disabled by isFetching
    await waitFor(() => expect(screen.getByText('GEN-001')).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/Search by airport/i);
    fireEvent.change(input, { target: { value: 'KSEA' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    // airport NOTAM + archive PIREP appear
    await waitFor(() => expect(screen.getByText('KSEA-A001')).toBeInTheDocument());
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/notams/airport/KSEA'))).toBe(
      true
    );
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/archive/pireps'))).toBe(true);
    // active filter chip shows and clears
    expect(screen.getByRole('button', { name: 'KSEA' })).toBeInTheDocument();
  });
});

describe('ArchiveTab helpers', () => {
  it('adaptNotamStats maps backend fields and collapses empty payloads', () => {
    expect(adaptNotamStats(null)).toBeNull();
    expect(adaptNotamStats({})).toBeNull();
    const s = adaptNotamStats({
      total_notams: 5,
      active_notams: 4,
      active_tfrs: 2,
      by_type: { D: 3 },
      last_refresh: '2026-07-16T10:00:00Z',
    });
    expect(s.total_active).toBe(4);
    expect(s.tfr_count).toBe(2);
    expect(s.last_update).toBe('2026-07-16T10:00:00Z');
    expect(s.by_type).toEqual({ D: 3 });
  });

  it('normalizeNotam derives type from notam_type and flags TFRs', () => {
    expect(normalizeNotam({ notam_type: 'TFR' })).toMatchObject({ type: 'TFR', isTfr: true });
    expect(normalizeNotam({ notam_type: 'D' })).toMatchObject({ type: 'D', isTfr: false });
    // absent type falls back to D and never crashes
    expect(normalizeNotam({})).toMatchObject({ type: 'D', isTfr: false });
  });
});
