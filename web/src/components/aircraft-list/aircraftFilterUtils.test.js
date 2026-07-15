import { describe, it, expect } from 'vitest';
import { filterAircraft } from './aircraftFilterUtils';

const NO_FILTERS = {
  military: null,
  emergency: false,
  climbing: false,
  descending: false,
  onGround: false,
  minAltitude: '',
  maxAltitude: '',
  minDistance: '',
  maxDistance: '',
  minSpeed: '',
  maxSpeed: '',
};

describe('filterAircraft altitude range', () => {
  const aircraft = [
    { hex: 'AAA111', alt: 5000 },
    { hex: 'BBB222', alt: 20000 },
    { hex: 'CCC333', alt: null }, // unknown altitude
    { hex: 'DDD444', alt: 'ground' },
    { hex: 'EEE555' }, // missing alt entirely
  ];

  it('excludes aircraft with unknown altitude from maxAltitude filter', () => {
    const result = filterAircraft(aircraft, '', { ...NO_FILTERS, maxAltitude: '10000' });
    const hexes = result.map((ac) => ac.hex);
    expect(hexes).toContain('AAA111');
    expect(hexes).not.toContain('BBB222');
    // Unknown altitude must not be treated as 0 ft
    expect(hexes).not.toContain('CCC333');
    expect(hexes).not.toContain('EEE555');
  });

  it('treats ground as 0 ft for maxAltitude filter', () => {
    const result = filterAircraft(aircraft, '', { ...NO_FILTERS, maxAltitude: '10000' });
    expect(result.map((ac) => ac.hex)).toContain('DDD444');
  });

  it('excludes aircraft with unknown altitude from minAltitude filter', () => {
    const result = filterAircraft(aircraft, '', { ...NO_FILTERS, minAltitude: '1000' });
    const hexes = result.map((ac) => ac.hex);
    expect(hexes).toEqual(expect.arrayContaining(['AAA111', 'BBB222']));
    expect(hexes).not.toContain('CCC333');
    expect(hexes).not.toContain('DDD444');
    expect(hexes).not.toContain('EEE555');
  });

  it('applies min and max together as a range', () => {
    const result = filterAircraft(aircraft, '', {
      ...NO_FILTERS,
      minAltitude: '1000',
      maxAltitude: '10000',
    });
    expect(result.map((ac) => ac.hex)).toEqual(['AAA111']);
  });
});
