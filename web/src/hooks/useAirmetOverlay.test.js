import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useAirmetOverlay,
  airmetHazardMeta,
  parseAirmetGeometry,
  AIRMET_HAZARDS,
} from './useAirmetOverlay';

const AREA = {
  advisory_id: 'A1',
  advisory_type: 'GAIRMET',
  hazard: 'TURB-HI',
  severity: 'MOD',
  polygon: {
    type: 'Polygon',
    coordinates: [
      [
        [-101, 39],
        [-99, 39],
        [-99, 41],
        [-101, 41],
        [-101, 39],
      ],
    ],
  },
};
const LINE = {
  advisory_id: 'Z1',
  advisory_type: 'GAIRMET',
  hazard: 'FZLVL',
  polygon: {
    type: 'LineString',
    coordinates: [
      [-100, 40],
      [-99, 41],
      [-98, 42],
    ],
  },
};

describe('airmet helpers', () => {
  it('airmetHazardMeta resolves exact + base-prefix hazards', () => {
    expect(airmetHazardMeta('TURB-HI')).toBe(AIRMET_HAZARDS['TURB-HI']);
    expect(airmetHazardMeta('ICE')).toBe(AIRMET_HAZARDS.ICE);
    // Unknown suffix falls back to the base hazard.
    expect(airmetHazardMeta('TURB-XX').label).toBe('Turbulence');
    expect(airmetHazardMeta('WHAT').label).toBe('AIRMET');
  });

  it('parseAirmetGeometry distinguishes AREA (closed) from LINE (open)', () => {
    const area = parseAirmetGeometry(AREA);
    expect(area.closed).toBe(true);
    expect(area.points[0]).toEqual({ lat: 39, lon: -101 });

    const line = parseAirmetGeometry(LINE);
    expect(line.closed).toBe(false);
    expect(line.points).toHaveLength(3);
  });
});

describe('useAirmetOverlay', () => {
  it('includes all AIRMET hazards (area + line)', () => {
    const { result } = renderHook(() =>
      useAirmetOverlay({ enabled: true, advisories: [AREA, LINE] })
    );
    expect(result.current.count).toBe(2);
    const hazards = result.current.airmets.map((a) => a.hazard).sort();
    expect(hazards).toEqual(['FZLVL', 'TURB-HI']);
  });

  it('drops non-AIRMET advisories', () => {
    const other = {
      advisory_id: 'S1',
      advisory_type: 'SIGMET',
      hazard: 'CONVECTIVE',
      polygon: AREA.polygon,
    };
    const { result } = renderHook(() =>
      useAirmetOverlay({ enabled: true, advisories: [AREA, other] })
    );
    expect(result.current.count).toBe(1);
  });

  it('returns empty when disabled', () => {
    const { result } = renderHook(() => useAirmetOverlay({ enabled: false, advisories: [AREA] }));
    expect(result.current.count).toBe(0);
  });

  it('getAirmetAtPoint hits AREAs only, never LINEs', () => {
    const { result } = renderHook(() =>
      useAirmetOverlay({ enabled: true, advisories: [AREA, LINE] })
    );
    expect(result.current.getAirmetAtPoint(40, -100)?.id).toBe('A1');
    expect(result.current.getAirmetAtPoint(0, 0)).toBeNull();
  });

  it('drawOnCanvas fills areas and strokes lines', () => {
    const { result } = renderHook(() =>
      useAirmetOverlay({ enabled: true, advisories: [AREA, LINE] })
    );
    const ctx = {
      canvas: { width: 800, height: 600 },
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      fillRect: vi.fn(),
      measureText: () => ({ width: 30 }),
      fillText: vi.fn(),
    };
    const toScreen = (lat, lon) => ({ x: (lon + 101) * 100, y: (41 - lat) * 100 });
    result.current.drawOnCanvas(ctx, toScreen, 1);
    expect(ctx.stroke).toHaveBeenCalledTimes(2); // area + line
    expect(ctx.fill).toHaveBeenCalledTimes(1); // area only
    expect(ctx.closePath).toHaveBeenCalledTimes(1); // area only
  });
});
