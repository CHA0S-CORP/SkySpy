import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AircraftListScreen } from './AircraftListScreen';
import {
  altitudeOf,
  barsFromRssi,
  categoryOf,
  compassDir,
  selectAircraft,
  toRow,
} from './listModel';

const FLEET = [
  {
    hex: 'a7e198',
    flight: 'DAL709 ',
    t: 'A21N',
    alt: 6525,
    gs: 285,
    vr: 1920,
    track: 74,
    distance_nm: 5.1,
    rssi: -8,
    squawk: '6745',
    r: 'N901DL',
    ownOp: 'Delta Air Lines',
    desc: 'Airbus A321neo',
    year: 2021,
  },
  {
    hex: 'adf2b7',
    flight: 'RCH471',
    t: 'C17',
    alt: 12250,
    gs: 388,
    vr: 1440,
    track: 250,
    distance_nm: 14.8,
    rssi: -16,
    squawk: '7700',
    military: true,
  },
  {
    hex: 'ad10e9',
    flight: 'ASA1548',
    t: 'B39M',
    alt: 0,
    gs: 0,
    track: 0,
    distance_nm: 4.2,
    rssi: -30,
    squawk: '4121',
  },
  {
    hex: 'ac2e45',
    flight: 'N884SD',
    t: 'AS50',
    alt: 1025,
    gs: 78,
    vr: -300,
    track: 328,
    distance_nm: 4.6,
    rssi: -22,
    squawk: '1200',
    category: 'A7',
  },
];

describe('listModel', () => {
  it('altitudeOf treats non-numeric alt as ground', () => {
    expect(altitudeOf({ alt: 'ground' })).toBe(0);
    expect(altitudeOf({ alt_baro: 5000 })).toBe(5000);
  });

  it('categoryOf maps military flag and light categories', () => {
    expect(categoryOf({ military: true })).toBe('military');
    expect(categoryOf({ category: 'A7' })).toBe('ga');
    expect(categoryOf({ category: 'A3' })).toBe('commercial');
  });

  it('barsFromRssi maps signal levels', () => {
    expect(barsFromRssi(-5)).toBe(4);
    expect(barsFromRssi(-15)).toBe(3);
    expect(barsFromRssi(-22)).toBe(2);
    expect(barsFromRssi(-33)).toBe(1);
    expect(barsFromRssi(undefined)).toBe(1);
  });

  it('compassDir maps track to 16-wind rose', () => {
    expect(compassDir(0)).toBe('N');
    expect(compassDir(91)).toBe('E');
    expect(compassDir(295)).toBe('WNW');
  });

  it('selectAircraft filters by search across hex/callsign/type/squawk', () => {
    expect(selectAircraft(FLEET, { query: 'dal' })).toHaveLength(1);
    expect(selectAircraft(FLEET, { query: '7700' })).toHaveLength(1);
    expect(selectAircraft(FLEET, { query: 'c17' })).toHaveLength(1);
  });

  it('selectAircraft applies chip filters', () => {
    expect(selectAircraft(FLEET, { filter: 'military' })).toHaveLength(1);
    expect(selectAircraft(FLEET, { filter: 'ground' })).toHaveLength(1);
    expect(selectAircraft(FLEET, { filter: 'emergency' })[0].hex).toBe('adf2b7');
    expect(selectAircraft(FLEET, { filter: 'climbing' })).toHaveLength(2);
  });

  it('selectAircraft sorts by key and direction', () => {
    const byDist = selectAircraft(FLEET, { sortBy: 'dist', sortDir: 'asc' });
    expect(byDist[0].hex).toBe('ad10e9');
    const byAltDesc = selectAircraft(FLEET, { sortBy: 'alt', sortDir: 'desc' });
    expect(byAltDesc[0].hex).toBe('adf2b7');
  });

  it('toRow renders ground and emergency states', () => {
    const ground = toRow(FLEET[2]);
    expect(ground.altDisp).toBe('ground');
    expect(ground.accent).toBe('transparent');
    const emerg = toRow(FLEET[1]);
    expect(emerg.sqkColor).toBe('var(--danger)');
    expect(emerg.isMil).toBe(true);
    const climb = toRow(FLEET[0]);
    expect(climb.vsDisp).toContain('↑');
  });

  it('toRow surfaces registration as tail when distinct from callsign', () => {
    // Registration present and different from the callsign → shown.
    expect(toRow({ hex: 'a1', flight: 'DAL709', r: 'N901DL' }).tail).toBe('N901DL');
    // Registration mirrors the callsign (GA style) → suppressed to avoid noise.
    expect(toRow({ hex: 'a2', flight: 'N884SD', r: 'N884SD' }).tail).toBeNull();
    // No registration in payload → null (guarded conditional render).
    expect(toRow({ hex: 'a3', flight: 'ASA1548' }).tail).toBeNull();
  });

  it('toRow surfaces operator, full type name, and year when present', () => {
    const r = toRow(FLEET[0]);
    expect(r.operator).toBe('Delta Air Lines');
    expect(r.typeFull).toBe('Airbus A321neo');
    expect(r.year).toBe('2021');
  });

  it('toRow guards missing operator/type-name/year as null', () => {
    const r = toRow({ hex: 'a4', flight: 'ASA1548' });
    expect(r.operator).toBeNull();
    expect(r.typeFull).toBeNull();
    expect(r.year).toBeNull();
  });

  it('toRow accepts year_built as a fallback for year', () => {
    expect(toRow({ hex: 'a5', year_built: 1998 }).year).toBe('1998');
  });
});

describe('AircraftListScreen', () => {
  it('renders rows and footer counts', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    expect(screen.getByText('DAL709')).toBeInTheDocument();
    expect(screen.getByText('4 of 4')).toBeInTheDocument();
    expect(screen.getByText('1 military')).toBeInTheDocument();
  });

  it('renders the registration tail line under the callsign', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    expect(screen.getByText('N901DL')).toBeInTheDocument();
  });

  it('renders operator, full type name, and year on the enriched row', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    expect(screen.getByTestId('v2-list-operator-a7e198')).toHaveTextContent('Delta Air Lines');
    const typeFull = screen.getByTestId('v2-list-type-full-a7e198');
    expect(typeFull).toHaveTextContent('Airbus A321neo');
    expect(screen.getByTestId('v2-list-year-a7e198')).toHaveTextContent('2021');
    // Rows without the enrichment omit the secondary elements entirely.
    expect(screen.queryByTestId('v2-list-operator-ad10e9')).toBeNull();
    expect(screen.queryByTestId('v2-list-type-full-ad10e9')).toBeNull();
  });

  it('filters via chips and search', async () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Military 1/ }));
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Military 1/ })); // toggle off
    fireEvent.change(screen.getByLabelText('Search aircraft'), { target: { value: 'ASA' } });
    // The search query write is debounced (300ms), so filtering settles async.
    await waitFor(() => expect(screen.queryByText('DAL709')).toBeNull());
    expect(screen.getByText('ASA1548')).toBeInTheDocument();
  });

  it('sorts when a column header is clicked', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    const altHeader = screen.getByRole('columnheader', { name: /^Altitude/ });
    fireEvent.click(altHeader); // asc
    fireEvent.click(altHeader); // desc
    expect(altHeader).toHaveAttribute('aria-sort', 'descending');
    const rows = screen.getAllByTestId(/v2-list-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'v2-list-row-adf2b7');
  });

  it('navigates to detail on row click', () => {
    const onSelect = vi.fn();
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={onSelect} />);
    fireEvent.click(screen.getByTestId('v2-list-row-a7e198'));
    expect(onSelect).toHaveBeenCalledWith('a7e198');
  });

  it('shows empty state when nothing matches', async () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search aircraft'), { target: { value: 'zzzz' } });
    // Search filtering is debounced (300ms).
    await waitFor(() =>
      expect(screen.getByText('No aircraft match the current filters')).toBeInTheDocument()
    );
  });
});

describe('AircraftListScreen bulk enrichment', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const bulkResponse = (aircraft) =>
    Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ requested: 0, found: 0, aircraft }),
    });

  it('renders photo thumbnail + PIA/LADD/INTEREST badges from the bulk endpoint', async () => {
    const fetchMock = vi.fn(() =>
      bulkResponse({
        A7E198: {
          photo_thumbnail_url: 'http://x/a7e198.jpg',
          source_data: [
            { source: 'faa', is_pia: true, is_ladd: false, is_interesting: false },
            { source: 'adsbx', is_pia: false, is_ladd: true, is_interesting: true },
          ],
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} apiBase="" />);

    await waitFor(() => expect(screen.getByTestId('v2-list-photo-a7e198')).toBeInTheDocument());
    expect(screen.getByTestId('v2-list-photo-a7e198')).toHaveAttribute(
      'src',
      'http://x/a7e198.jpg'
    );
    expect(screen.getByTestId('v2-list-flag-pia-a7e198')).toBeInTheDocument();
    expect(screen.getByTestId('v2-list-flag-ladd-a7e198')).toBeInTheDocument();
    expect(screen.getByTestId('v2-list-flag-interest-a7e198')).toBeInTheDocument();

    // The bulk request targets the cap-100 cache-only endpoint with upper hexes.
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/airframes/bulk?icao=');
    expect(fetchMock.mock.calls[0][0]).toContain('A7E198');

    // Rows without enrichment render nothing extra.
    expect(screen.queryByTestId('v2-list-photo-adf2b7')).toBeNull();
    expect(screen.queryByTestId('v2-list-flag-pia-adf2b7')).toBeNull();
  });

  it('renders nothing extra when the bulk endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network')))
    );
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} apiBase="" />);
    // Base rows still render; no enrichment artifacts appear.
    expect(screen.getByText('DAL709')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('v2-list-photo-a7e198')).toBeNull());
    expect(screen.queryByTestId('v2-list-flag-pia-a7e198')).toBeNull();
  });
});
