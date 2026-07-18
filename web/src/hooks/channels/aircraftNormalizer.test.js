import { describe, it, expect } from 'vitest';
import { normalizeAircraft } from './aircraftNormalizer';

describe('aircraftNormalizer ghost fields', () => {
  it('passes through ghost + ghost_of', () => {
    const out = normalizeAircraft({ hex: '~abc123', ghost: true, ghost_of: 'a1b2c3' });
    expect(out.ghost).toBe(true);
    expect(out.ghost_of).toBe('a1b2c3');
  });

  it('defaults ghost to false in full mode when absent', () => {
    const out = normalizeAircraft({ hex: 'a1b2c3' });
    expect(out.ghost).toBe(false);
    expect(out.ghost_of).toBeNull();
  });

  it('emits null ghost in partial mode when absent (preserves prior on merge)', () => {
    const out = normalizeAircraft({ hex: 'a1b2c3' }, { partial: true });
    expect(out.ghost).toBeNull();
  });

  it('honors explicit ghost=false in partial mode', () => {
    const out = normalizeAircraft({ hex: 'a1b2c3', ghost: false }, { partial: true });
    expect(out.ghost).toBe(false);
  });
});
