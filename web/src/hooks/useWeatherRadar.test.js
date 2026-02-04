import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWeatherRadar, getRadarColor, getRadarTileUrl, RADAR_COLOR_SCALE } from './useWeatherRadar';

// Mock Image
class MockImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.crossOrigin = null;
    this._src = null;
  }

  get src() {
    return this._src;
  }

  set src(value) {
    this._src = value;
    // Simulate async load
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 10);
  }
}

describe('useWeatherRadar', () => {
  beforeEach(() => {
    global.Image = MockImage;
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should not fetch when disabled', () => {
    const { result } = renderHook(() =>
      useWeatherRadar({
        enabled: false,
        feederLocation: { lat: 40, lon: -100 },
        radarRange: 100,
      })
    );

    expect(result.current.radarImage).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('should calculate bounds from feeder location and range', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ utc_valid: '2024-01-01T12:00:00Z' }),
    });

    const { result } = renderHook(() =>
      useWeatherRadar({
        enabled: true,
        feederLocation: { lat: 40, lon: -100 },
        radarRange: 60,
      })
    );

    // Advance timers to trigger async operations
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Bounds should be calculated from feeder location + range
    expect(result.current.radarBounds).toBeDefined();
  });

  it('should return tile layer URL for Leaflet', () => {
    const { result } = renderHook(() =>
      useWeatherRadar({
        enabled: false,
        feederLocation: { lat: 40, lon: -100 },
        radarRange: 100,
      })
    );

    expect(result.current.tileLayerUrl).toContain('mesonet.agron.iastate.edu');
  });

  it('should provide WMS config', () => {
    const { result } = renderHook(() =>
      useWeatherRadar({
        enabled: false,
        feederLocation: { lat: 40, lon: -100 },
        radarRange: 100,
        source: 'mesonet',
      })
    );

    expect(result.current.wmsConfig).toHaveProperty('url');
    expect(result.current.wmsConfig).toHaveProperty('layers');
    expect(result.current.wmsConfig.transparent).toBe(true);
  });

  it('should provide color utilities', () => {
    const { result } = renderHook(() =>
      useWeatherRadar({
        enabled: false,
        feederLocation: { lat: 40, lon: -100 },
        radarRange: 100,
      })
    );

    expect(result.current.colorScale).toBeDefined();
    expect(result.current.getRadarColor).toBeDefined();
  });
});

describe('getRadarColor', () => {
  it('should return transparent for values below 5 dBZ', () => {
    expect(getRadarColor(0)).toBe('transparent');
    expect(getRadarColor(4)).toBe('transparent');
  });

  it('should return green for light precipitation', () => {
    const color = getRadarColor(25);
    expect(color).toMatch(/rgba\(\d+, \d+, \d+, 0\.7\)/);
  });

  it('should return yellow for moderate precipitation', () => {
    const color = getRadarColor(37);
    expect(color).toMatch(/rgba\(255, 255, 0/);
  });

  it('should return red for heavy precipitation', () => {
    const color = getRadarColor(52);
    expect(color).toMatch(/rgba\(255, 0, 0/);
  });

  it('should return purple for extreme values', () => {
    const color = getRadarColor(75);
    expect(color).toMatch(/rgba\(255, 0, 255/);
  });

  it('should respect opacity parameter', () => {
    const color = getRadarColor(30, 0.5);
    expect(color).toMatch(/0\.5\)$/);
  });
});

describe('getRadarTileUrl', () => {
  const bounds = { north: 45, south: 35, east: -95, west: -105 };

  it('should generate mesonet URL by default', () => {
    const url = getRadarTileUrl(bounds, 512, 512);
    expect(url).toContain('mesonet.agron.iastate.edu');
    expect(url).toContain('nexrad-n0q-900913');
    expect(url).toContain('WIDTH=512');
    expect(url).toContain('HEIGHT=512');
  });

  it('should generate NWS URL when specified', () => {
    const url = getRadarTileUrl(bounds, 512, 512, 'nws');
    expect(url).toContain('opengeo.ncep.noaa.gov');
    expect(url).toContain('conus_bref_qcd');
  });

  it('should include correct BBOX', () => {
    const url = getRadarTileUrl(bounds, 512, 512);
    expect(url).toContain('BBOX=-105,35,-95,45');
  });
});

describe('RADAR_COLOR_SCALE', () => {
  it('should have complete coverage from 5 to 100 dBZ', () => {
    expect(RADAR_COLOR_SCALE[0].min).toBe(5);
    expect(RADAR_COLOR_SCALE[RADAR_COLOR_SCALE.length - 1].max).toBe(100);
  });

  it('should have sequential, non-overlapping ranges', () => {
    for (let i = 1; i < RADAR_COLOR_SCALE.length; i++) {
      expect(RADAR_COLOR_SCALE[i].min).toBe(RADAR_COLOR_SCALE[i - 1].max);
    }
  });

  it('should have RGB color objects', () => {
    RADAR_COLOR_SCALE.forEach((scale) => {
      expect(scale.color).toHaveProperty('r');
      expect(scale.color).toHaveProperty('g');
      expect(scale.color).toHaveProperty('b');
    });
  });

  it('should have labels for each intensity level', () => {
    RADAR_COLOR_SCALE.forEach((scale) => {
      expect(typeof scale.label).toBe('string');
      expect(scale.label.length).toBeGreaterThan(0);
    });
  });
});
