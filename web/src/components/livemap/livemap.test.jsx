import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import {
  CATEGORY_COLORS,
  altitudeOf,
  categoryOf,
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

  const AC = { hex: 'a7e198', flight: 'DAL571', t: 'A21N', lat: 33.0, lon: -117.1, gs: 480, track: 90 };
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

  it('handles 1000 aircraft without throwing', () => {
    const layer = new CanvasAircraftLayer(map, {});
    const fleet = Array.from({ length: 1000 }, (_, i) => ({
      hex: `ac${i.toString(16)}`,
      flight: `T${i}`,
      lat: 32.8 + (Math.sin(i) * 0.4),
      lon: -117.2 + (Math.cos(i) * 0.4),
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
