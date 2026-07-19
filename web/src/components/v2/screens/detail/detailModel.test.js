import { describe, it, expect } from 'vitest';
import { splitFlights } from './detailModel';

// Build a sample at a given ISO minute offset from a base epoch.
const base = Date.parse('2026-07-18T00:00:00Z');
const s = (min, extra = {}) => ({
  timestamp: new Date(base + min * 60000).toISOString(),
  lat: 33 + min * 0.001,
  lon: -118 + min * 0.001,
  altitude: 10000 + min * 100,
  callsign: 'AAL1',
  ...extra,
});

describe('splitFlights', () => {
  it('returns [] for empty input', () => {
    expect(splitFlights([])).toEqual([]);
    expect(splitFlights(null)).toEqual([]);
  });

  it('keeps a continuous track as a single leg', () => {
    const pts = [s(0), s(2), s(4), s(6)];
    const legs = splitFlights(pts);
    expect(legs).toHaveLength(1);
    expect(legs[0].count).toBe(4);
    expect(legs[0].callsign).toBe('AAL1');
  });

  it('splits on a time gap longer than the threshold', () => {
    // 0,2 min then a 20-min gap then 22,24 min -> two flights
    const pts = [s(0), s(2), s(22), s(24)];
    const legs = splitFlights(pts);
    expect(legs).toHaveLength(2);
    expect(legs[0].count).toBe(2);
    expect(legs[1].count).toBe(2);
  });

  it('does not split on a gap at or below the threshold', () => {
    // 10-min gap (< 15) stays one leg
    const pts = [s(0), s(2), s(12), s(14)];
    expect(splitFlights(pts)).toHaveLength(1);
  });

  it('splits on a callsign change with no time gap', () => {
    const pts = [s(0), s(2), s(4, { callsign: 'AAL2' }), s(6, { callsign: 'AAL2' })];
    const legs = splitFlights(pts);
    expect(legs).toHaveLength(2);
    expect(legs[0].callsign).toBe('AAL1');
    expect(legs[1].callsign).toBe('AAL2');
  });

  it('summarizes each leg (duration, alt band, times)', () => {
    const pts = [s(0, { altitude: 5000 }), s(4, { altitude: 9000 })];
    const [leg] = splitFlights(pts);
    expect(leg.minAlt).toBe(5000);
    expect(leg.maxAlt).toBe(9000);
    expect(leg.durationMin).toBeCloseTo(4);
    expect(leg.start).toBe(pts[0].timestamp);
    expect(leg.end).toBe(pts[1].timestamp);
  });

  it('honors a custom gapSec', () => {
    const pts = [s(0), s(5)]; // 5-min gap
    expect(splitFlights(pts, { gapSec: 120 })).toHaveLength(2);
    expect(splitFlights(pts, { gapSec: 600 })).toHaveLength(1);
  });
});
