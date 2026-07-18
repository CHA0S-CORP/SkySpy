import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  FlightRoute,
  RouteSummary,
  RouteRow,
  parseRoute,
  hasRoute,
  routeProgress,
} from './FlightRoute';

describe('parseRoute', () => {
  it('reads flat and nested route shapes', () => {
    expect(parseRoute({ origin: { iata: 'LAX' }, destination: { iata: 'PHX' } }).origin.iata).toBe(
      'LAX'
    );
    const nested = parseRoute({
      route: { origin: { icao: 'KLAX' }, destination: { icao: 'KPHX' } },
    });
    expect(nested.origin.icao).toBe('KLAX');
    expect(nested.destination.icao).toBe('KPHX');
  });

  it('returns undefined parts for empty input', () => {
    const { origin, destination } = parseRoute(null);
    expect(origin).toBeUndefined();
    expect(destination).toBeUndefined();
  });
});

describe('parseRoute identity fields', () => {
  it('pulls flight number, airline, and callsign from the nested route', () => {
    const parsed = parseRoute({
      callsign: 'AAL100',
      route: {
        origin: { iata: 'LAX' },
        destination: { iata: 'JFK' },
        flight_number: '100',
        airline_code: 'AAL',
      },
    });
    expect(parsed.flightNumber).toBe('100');
    expect(parsed.airline).toBe('AAL');
    expect(parsed.callsign).toBe('AAL100');
  });
});

describe('routeProgress', () => {
  it('computes percentage flown along the great circle', () => {
    const o = { lat: 0, lon: 0 };
    const d = { lat: 0, lon: 10 };
    expect(routeProgress(o, d, { lat: 0, lon: 5 }).pct).toBeCloseTo(50, 0);
    expect(routeProgress(o, d, { lat: 0, lon: 0 }).pct).toBe(0);
    expect(routeProgress(o, d, null)).toBeNull();
    expect(routeProgress(o, { lat: 0, lon: 0 }, o)).toBeNull(); // zero-length route
  });
});

describe('hasRoute', () => {
  it('requires two different airports', () => {
    expect(hasRoute({ iata: 'LAX' }, { iata: 'PHX' })).toBe(true);
    expect(hasRoute({ iata: 'SEA' }, { iata: 'SEA' })).toBe(false); // degenerate SEA→SEA
    expect(hasRoute({ iata: 'sea' }, { iata: 'SEA' })).toBe(false); // case-insensitive
    expect(hasRoute({ iata: 'LAX' }, null)).toBe(false);
    expect(hasRoute(null, null)).toBe(false);
  });
});

describe('FlightRoute / RouteSummary', () => {
  const origin = { iata: 'LAX', city: 'Los Angeles' };
  const destination = { iata: 'PHX', city: 'Phoenix' };

  it('renders nothing when origin and destination are the same airport', () => {
    const same = { iata: 'SEA', city: 'Seattle' };
    const { container } = render(<FlightRoute origin={same} destination={{ ...same }} />);
    expect(container.querySelector('.v2-det__route')).toBeNull();
    const { container: c2 } = render(<RouteSummary origin={same} destination={{ ...same }} />);
    expect(c2.querySelector('.v2-det__route-mini')).toBeNull();
  });

  it('FlightRoute renders codes + cities, null when incomplete', () => {
    const { container, rerender } = render(
      <FlightRoute origin={origin} destination={destination} />
    );
    expect(screen.getByText('Flight Route')).toBeInTheDocument();
    expect(screen.getByText('LAX')).toBeInTheDocument();
    expect(screen.getByText('Phoenix')).toBeInTheDocument();
    rerender(<FlightRoute origin={origin} destination={null} />);
    expect(container.querySelector('.v2-det__route')).toBeNull();
  });

  it('RouteSummary renders a compact LAX/PHX badge, null when incomplete', () => {
    const { container, rerender } = render(
      <RouteSummary origin={origin} destination={destination} />
    );
    const mini = container.querySelector('.v2-det__route-mini');
    expect(mini.textContent).toContain('LAX');
    expect(mini.textContent).toContain('PHX');
    rerender(<RouteSummary origin={null} destination={destination} />);
    expect(container.querySelector('.v2-det__route-mini')).toBeNull();
  });

  it('shows flight number, a linked destination airport, and progress', () => {
    const o = { iata: 'LAX', icao: 'KLAX', city: 'Los Angeles', lat: 33.94, lon: -118.4 };
    const d = { iata: 'JFK', icao: 'KJFK', city: 'New York', lat: 40.64, lon: -73.78 };
    const { container } = render(
      <FlightRoute
        origin={o}
        destination={d}
        position={{ lat: 39, lon: -95 }}
        airline="AAL"
        flightNumber="100"
      />
    );
    expect(screen.getByText('AAL 100')).toBeInTheDocument();
    const link = screen.getByText('JFK').closest('a');
    expect(link.getAttribute('href')).toContain('KJFK');
    expect(container.querySelector('.v2-det__route-prog-fill')).not.toBeNull();
    expect(container.textContent).toMatch(/% complete/);
    expect(container.textContent).toMatch(/nm to go/);
  });

  it('RouteRow falls back iata → icao → -- ', () => {
    const { container } = render(<RouteRow origin={{ icao: 'KSAN' }} destination={{}} />);
    expect(screen.getByText('KSAN')).toBeInTheDocument();
    expect(container.textContent).toContain('--');
  });
});
