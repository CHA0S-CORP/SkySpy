import { describe, it, expect } from 'vitest';
import { DEFAULT_OVERLAYS, OVERLAY_DEFS, overlaysActiveCount, makeRadarMatchFn } from './mapState';

describe('makeRadarMatchFn (assistant radar filter)', () => {
  const ac = (o) => ({ hex: 'A11111', flight: 'N123', category: 'A1', t: 'C172', ...o });

  it('returns null for empty / missing match', () => {
    expect(makeRadarMatchFn(null)).toBeNull();
    expect(makeRadarMatchFn({})).toBeNull();
  });

  it('ga matches light categories, excludes military and airliners', () => {
    const fn = makeRadarMatchFn({ ga: true });
    expect(fn(ac({ category: 'A1' }))).toBe(true);
    expect(fn(ac({ category: 'A7' }))).toBe(true); // rotorcraft
    expect(fn(ac({ category: 'A5' }))).toBe(false); // heavy
    expect(fn(ac({ category: 'A1', military: true }))).toBe(false);
  });

  it('military boolean matches categoryOf', () => {
    expect(makeRadarMatchFn({ military: true })(ac({ military: true }))).toBe(true);
    expect(makeRadarMatchFn({ military: true })(ac({ military: false }))).toBe(false);
    expect(makeRadarMatchFn({ military: false })(ac({ military: true }))).toBe(false);
  });

  it('emergency matches squawk or flag', () => {
    const fn = makeRadarMatchFn({ emergency: true });
    expect(fn(ac({ squawk: '7700' }))).toBe(true);
    expect(fn(ac({ squawk: '1200' }))).toBe(false);
    expect(fn(ac({ emergency: true }))).toBe(true);
  });

  it('hexes allowlist (case-insensitive)', () => {
    const fn = makeRadarMatchFn({ hexes: ['ADBABD', 'AE1234'] });
    expect(fn(ac({ hex: 'adbabd' }))).toBe(true);
    expect(fn(ac({ hex: 'FFFFFF' }))).toBe(false);
  });

  it('type, callsign prefix, altitude and distance band AND together', () => {
    const fn = makeRadarMatchFn({
      types: ['C172'],
      callsignPrefix: ['N'],
      altMax: 5000,
      distMax: 50,
    });
    expect(fn(ac({ t: 'C172', flight: 'N99', alt: 3000, distance_nm: 10 }))).toBe(true);
    expect(fn(ac({ t: 'B738', flight: 'N99', alt: 3000, distance_nm: 10 }))).toBe(false);
    expect(fn(ac({ t: 'C172', flight: 'UAL1', alt: 3000, distance_nm: 10 }))).toBe(false);
    expect(fn(ac({ t: 'C172', flight: 'N99', alt: 9000, distance_nm: 10 }))).toBe(false);
    expect(fn(ac({ t: 'C172', flight: 'N99', alt: 3000, distance_nm: 99 }))).toBe(false);
  });

  it('anyOf (fuzzy class) matches by category OR type-prefix', () => {
    // widebody spec: heavy category OR a widebody type prefix
    const fn = makeRadarMatchFn({ anyOf: [{ cat: 'A5' }, { tp: 'B77' }, { tp: 'A35' }] });
    expect(fn(ac({ t: 'B77W', category: null }))).toBe(true); // variant via prefix
    expect(fn(ac({ t: 'A359', category: null }))).toBe(true);
    expect(fn(ac({ t: 'XXXX', category: 'A5' }))).toBe(true); // heavy category
    expect(fn(ac({ t: 'B738', category: 'A3' }))).toBe(false); // narrowbody
  });

  it('typePrefixes matches a family', () => {
    const fn = makeRadarMatchFn({ typePrefixes: ['B73'] });
    expect(fn(ac({ t: 'B738' }))).toBe(true);
    expect(fn(ac({ t: 'A320' }))).toBe(false);
  });

  it('distMax computes distance from feeder when aircraft lacks distance_nm', () => {
    const feeder = { lat: 32.8, lon: -117.2 };
    const fn = makeRadarMatchFn({ distMax: 30 }, feeder);
    expect(fn(ac({ lat: 32.85, lon: -117.25 }))).toBe(true); // ~4nm
    expect(fn(ac({ lat: 34.5, lon: -117.2 }))).toBe(false); // ~100nm
  });
});

describe('mapState overlay defaults', () => {
  it('includes a pireps toggle defaulting to false', () => {
    expect(DEFAULT_OVERLAYS.pireps).toBe(false);
  });

  it('surfaces pireps + notams(TFRs) in OVERLAY_DEFS so the LayersPanel renders them', () => {
    const keys = OVERLAY_DEFS.map((d) => d.key);
    expect(keys).toContain('pireps');
    expect(keys).toContain('notams');
    const pireps = OVERLAY_DEFS.find((d) => d.key === 'pireps');
    expect(pireps.label).toBe('PIREPs');
  });

  it('includes a wildfires toggle defaulting to false', () => {
    expect(DEFAULT_OVERLAYS.wildfires).toBe(false);
    const keys = OVERLAY_DEFS.map((d) => d.key);
    expect(keys).toContain('wildfires');
    expect(OVERLAY_DEFS.find((d) => d.key === 'wildfires').label).toBe('Wildfires');
  });

  it('every overlay def key has a default entry', () => {
    for (const { key } of OVERLAY_DEFS) {
      expect(key in DEFAULT_OVERLAYS).toBe(true);
    }
  });

  it('overlaysActiveCount counts pireps but not the always-on range rings', () => {
    expect(overlaysActiveCount({ rangeRings: true })).toBe(0);
    expect(overlaysActiveCount({ pireps: true, notams: true })).toBe(2);
  });
});
