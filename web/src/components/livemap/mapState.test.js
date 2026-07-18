import { describe, it, expect } from 'vitest';
import { DEFAULT_OVERLAYS, OVERLAY_DEFS, overlaysActiveCount } from './mapState';

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
