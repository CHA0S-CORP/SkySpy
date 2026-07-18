import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import {
  CATEGORY_COLORS,
  altitudeColor,
  altitudeOf,
  altitudeRGB,
  categoryOf,
  colorFor,
  labelLines,
  leadLength,
  rectsOverlap,
  severityColor,
} from './render/symbology';
import { CanvasAircraftLayer } from './render/CanvasAircraftLayer';

describe('symbology', () => {
  it('leadLength is a short v1-style vector capped at 20px (gs/25)', () => {
    expect(leadLength(0)).toBe(0);
    expect(leadLength(200)).toBe(8);
    expect(leadLength(1000)).toBe(20);
  });

  it('categoryOf maps military/ga/commercial', () => {
    expect(categoryOf({ military: true })).toBe('military');
    expect(categoryOf({ category: 'A7' })).toBe('ga');
    expect(categoryOf({ category: 'A3' })).toBe('commercial');
    expect(CATEGORY_COLORS.commercial).toBe('#3ddc84');
  });

  it('altitudeOf + labelLines format (alt in hundreds)', () => {
    expect(altitudeOf({ alt: 35000 })).toBe(35000);
    const lines = labelLines({ flight: 'DAL571 ', gs: 480, alt: 35000, t: 'A21N' });
    expect(lines.cs).toBe('DAL571');
    expect(lines.l1).toBe('480kts · 350');
    expect(lines.l2).toBe('A21N');
  });

  it('severityColor only for safety aircraft', () => {
    expect(severityColor({}, false)).toBeNull();
    expect(severityColor({ safety: { severity: 'critical' } }, false)).toBe('#f2585d');
    expect(severityColor({}, true)).toBe('#f5b544');
  });

  it('rectsOverlap detects overlap', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
  });

  it('altitudeRGB ramps green→yellow→orange→magenta across bands', () => {
    expect(altitudeRGB(0)).toEqual({ r: 50, g: 255, b: 100 }); // ground green
    expect(altitudeRGB(10000)).toEqual({ r: 255, g: 255, b: 0 }); // yellow
    expect(altitudeRGB(45000)).toEqual({ r: 255, g: 0, b: 255 }); // magenta
    expect(altitudeColor(0)).toBe('rgb(50,255,100)');
    // non-finite / negative → ground green
    expect(altitudeRGB(undefined)).toEqual({ r: 50, g: 255, b: 100 });
  });

  it('colorFor honors selection, altitude mode, and category default', () => {
    expect(colorFor({ alt: 35000 }, 'altitude', true)).toBe('#ffffff'); // selected wins
    expect(colorFor({ alt: 0 }, 'altitude', false)).toBe('rgb(50,255,100)');
    expect(colorFor({ military: true }, 'category', false)).toBe(CATEGORY_COLORS.military);
  });
});

// Stub a no-op 2D context so the draw loop runs in jsdom.
function stubCanvas() {
  const ctx = new Proxy(
    {
      measureText: () => ({ width: 40 }),
      canvas: { width: 0, height: 0 },
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      },
      set() {
        return true;
      },
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  return ctx;
}

describe('CanvasAircraftLayer', () => {
  let container;
  let map;

  beforeEach(() => {
    stubCanvas();
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 700, configurable: true });
    document.body.appendChild(container);
    map = L.map(container, { center: [32.8, -117.2], zoom: 9 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const AC = {
    hex: 'a7e198',
    flight: 'DAL571',
    t: 'A21N',
    lat: 33.0,
    lon: -117.1,
    gs: 480,
    track: 90,
  };
  const FAR = { hex: 'ffff01', flight: 'FAR1', lat: 10.0, lon: 10.0, gs: 300, track: 0 };

  it('creates a canvas overlay in the map container', () => {
    const layer = new CanvasAircraftLayer(map, {});
    expect(container.querySelector('canvas.lm-canvas')).toBeTruthy();
    layer.destroy();
    expect(container.querySelector('canvas.lm-canvas')).toBeNull();
  });

  it('builds a screen index only for in-viewport aircraft (culls far ones)', () => {
    const layer = new CanvasAircraftLayer(map, {});
    layer.setData([AC, FAR], { current: {} });
    layer._draw();
    const hexes = layer.screenIndex.map((s) => s.hex);
    expect(hexes).toContain('A7E198');
    expect(hexes).not.toContain('FFFF01');
    layer.destroy();
  });

  it('hitTest returns the nearest blip within radius', () => {
    const layer = new CanvasAircraftLayer(map, {});
    layer.setData([AC], { current: {} });
    layer._draw();
    const pt = layer.screenIndex[0];
    expect(layer.hitTest({ x: pt.x + 3, y: pt.y + 3 }, 14)).toBe('A7E198');
    expect(layer.hitTest({ x: pt.x + 500, y: pt.y + 500 }, 14)).toBeNull();
    layer.destroy();
  });

  it('merges interpolated positions from positionsRef', () => {
    const layer = new CanvasAircraftLayer(map, {});
    const positionsRef = { current: { A7E198: { lat: 32.9, lon: -117.15, track: 45 } } };
    layer.setData([AC], positionsRef);
    layer._draw();
    // the projected point should reflect the interpolated lat/lon, not the raw
    const rawPt = map.latLngToContainerPoint(L.latLng(AC.lat, AC.lon));
    const idx = layer.screenIndex[0];
    expect(idx.x).not.toBeCloseTo(rawPt.x, 0);
    layer.destroy();
  });

  it('click on a blip fires onSelect', () => {
    const onSelect = vi.fn();
    const layer = new CanvasAircraftLayer(map, { onSelect });
    layer.setData([AC], { current: {} });
    layer._draw();
    const pt = layer.screenIndex[0];
    map.fire('click', { containerPoint: L.point(pt.x, pt.y), latlng: L.latLng(AC.lat, AC.lon) });
    expect(onSelect).toHaveBeenCalledWith('A7E198');
    layer.destroy();
  });

  it('draws TFR + PIREP overlays without throwing (polygon and point+radius)', () => {
    const layer = new CanvasAircraftLayer(map, {});
    layer.setOverlays({ notams: true, pireps: true });
    layer.setOverlayData({
      tfrs: [
        // polygon-geometry TFR
        {
          notam_id: 'T1',
          polygon: {
            coordinates: [
              [
                [-117.2, 32.7],
                [-117.1, 32.9],
                [-117.0, 32.7],
                [-117.2, 32.7],
              ],
            ],
          },
        },
        // point+radius TFR (backend shape)
        { notam_id: 'T2', latitude: 32.9, longitude: -117.15, radius_nm: 5 },
      ],
      pireps: [{ id: 1, lat: 32.9, lon: -117.1, turbulence: 'SEV' }],
    });
    layer.setData([AC], { current: {} });
    expect(() => layer._draw()).not.toThrow();
    layer.destroy();
  });

  it('auto label threshold ramps down (more labels) as zoom increases', () => {
    const layer = new CanvasAircraftLayer(map, {});
    map.setZoom(6);
    expect(layer._autoLabelThreshold()).toBe(2);
    map.setZoom(9);
    expect(layer._autoLabelThreshold()).toBe(1);
    map.setZoom(12);
    expect(layer._autoLabelThreshold()).toBe(0);
    layer.destroy();
  });

  it('handles 1000 aircraft without throwing', () => {
    const layer = new CanvasAircraftLayer(map, {});
    const fleet = Array.from({ length: 1000 }, (_, i) => ({
      hex: `ac${i.toString(16)}`,
      flight: `T${i}`,
      lat: 32.8 + Math.sin(i) * 0.4,
      lon: -117.2 + Math.cos(i) * 0.4,
      gs: 200 + (i % 300),
      track: i % 360,
    }));
    layer.setData(fleet, { current: {} });
    expect(() => layer._draw()).not.toThrow();
    // most should be culled to the viewport; index is bounded by the visible set
    expect(layer.screenIndex.length).toBeGreaterThan(0);
    layer.destroy();
  });
});
