import { afterEach, describe, expect, it, vi } from 'vitest';
import { cartoTileUrl } from './basemap';

afterEach(() => vi.unstubAllEnvs());

describe('cartoTileUrl', () => {
  it('preserves the existing tile URL when no key is configured', () => {
    vi.stubEnv('VITE_CARTO_API_KEY', '');
    expect(cartoTileUrl()).toBe(
      'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
    );
  });

  it('uses the requested style and encodes the trimmed key', () => {
    vi.stubEnv('VITE_CARTO_API_KEY', '  a+b&c  ');
    expect(cartoTileUrl('dark_all')).toBe(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=a%2Bb%26c'
    );
  });

  it('omits the query parameter for a whitespace-only key', () => {
    vi.stubEnv('VITE_CARTO_API_KEY', '   ');
    expect(cartoTileUrl()).not.toContain('?');
  });
});
