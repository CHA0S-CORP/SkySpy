import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});

describe('AircraftListScreen', () => {
  it('renders rows and footer counts', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    expect(screen.getByText('DAL709')).toBeInTheDocument();
    expect(screen.getByText('4 of 4')).toBeInTheDocument();
    expect(screen.getByText('1 military')).toBeInTheDocument();
  });

  it('filters via chips and search', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Military 1/ }));
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Military 1/ })); // toggle off
    fireEvent.change(screen.getByLabelText('Search aircraft'), { target: { value: 'ASA' } });
    expect(screen.getByText('ASA1548')).toBeInTheDocument();
    expect(screen.queryByText('DAL709')).toBeNull();
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

  it('shows empty state when nothing matches', () => {
    render(<AircraftListScreen aircraft={FLEET} onSelectAircraft={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search aircraft'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No aircraft match the current filters')).toBeInTheDocument();
  });
});
