import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryScreen } from './HistoryScreen';
import {
  activityBins,
  airlineOf,
  categoryOfSession,
  historyKpis,
  selectSessions,
  toSessionCard,
} from './historyModel';

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
    expect(card.hasSafety).toBe(false);
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
      if (u.includes('/sessions')) return respond({ sessions: [S1, S2] });
      if (u.includes('/safety/events'))
        return respond({ events: [{ id: 9, icao_hex: 'ADF2B7', event_type: 'EMERGENCY_SQUAWK' }] });
      return respond([]);
    });
  });

  const renderScreen = (props = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <HistoryScreen apiBase="" onSelectAircraft={vi.fn()} onViewEvent={vi.fn()} {...props} />
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
    renderScreen({ hashParams: { data: 'archive' } });
    await waitFor(() =>
      expect(screen.getByText('No archive records in this window')).toBeInTheDocument()
    );
  });
});
