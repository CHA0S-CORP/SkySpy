import { describe, it, expect } from 'vitest';
import { airspaceRings, pointInRing, normAirspaceClass, airspaceColor } from './symbology';

// A closed square ring [lon,lat] pairs (GeoJSON order) around (0,0).
const square = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

describe('airspaceRings', () => {
  it('extracts the outer ring of a GeoJSON Polygon as {lat,lon}', () => {
    const rings = airspaceRings({ type: 'Polygon', coordinates: [square] });
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual({ lat: -1, lon: -1 });
  });

  it('extracts one ring per polygon of a MultiPolygon (the old blind spot)', () => {
    const rings = airspaceRings({
      type: 'MultiPolygon',
      coordinates: [[square], [square]],
    });
    expect(rings).toHaveLength(2);
    expect(rings[1]).toHaveLength(5);
  });

  it('accepts a bare {points} ring', () => {
    const rings = airspaceRings({
      points: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
      ],
    });
    expect(rings).toHaveLength(1);
  });

  it('drops degenerate rings (<3 points) and non-geometry input', () => {
    expect(airspaceRings({ type: 'Polygon', coordinates: [[[0, 0]]] })).toEqual([]);
    expect(airspaceRings(null)).toEqual([]);
    expect(airspaceRings({})).toEqual([]);
  });
});

describe('pointInRing', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('detects inside vs outside', () => {
    expect(pointInRing({ x: 5, y: 5 }, ring)).toBe(true);
    expect(pointInRing({ x: 15, y: 5 }, ring)).toBe(false);
  });
});

describe('normAirspaceClass / airspaceColor', () => {
  it('passes known classes through and defaults unknown to E', () => {
    expect(normAirspaceClass('b')).toBe('B');
    expect(normAirspaceClass('RESTRICTED')).toBe('RESTRICTED');
    expect(normAirspaceClass('weird')).toBe('E');
    expect(normAirspaceClass(null)).toBe('E');
  });
  it('builds an rgba string with the requested alpha', () => {
    expect(airspaceColor('B', 0.5)).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
  });
});
