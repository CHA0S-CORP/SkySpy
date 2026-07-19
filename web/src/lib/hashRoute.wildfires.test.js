import { describe, it, expect } from 'vitest';
import { parseHash, VALID_TABS } from './hashRoute';

describe('hashRoute #wildfires', () => {
  it('lists wildfires as a valid tab', () => {
    expect(VALID_TABS).toContain('wildfires');
  });

  it('parses #wildfires to the wildfires tab (not the map fallback)', () => {
    expect(parseHash('#wildfires').tab).toBe('wildfires');
  });

  it('parses the deep-linked selected-fire param', () => {
    expect(parseHash('#wildfires?sel=101').params.sel).toBe('101');
  });
});
