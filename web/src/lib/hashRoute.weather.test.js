import { describe, it, expect } from 'vitest';
import { parseHash, VALID_TABS } from './hashRoute';

describe('hashRoute #weather', () => {
  it('lists weather as a valid tab', () => {
    expect(VALID_TABS).toContain('weather');
  });

  it('parses #weather to the weather tab', () => {
    expect(parseHash('#weather').tab).toBe('weather');
  });

  it('parses deep-linked wx sub-tab param', () => {
    expect(parseHash('#weather?wx=Turbulence').params.wx).toBe('Turbulence');
  });
});
