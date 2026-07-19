import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useTurbulenceOverlay,
  getTurbulenceSeverity,
  parseAdvisoryCoords,
  isPointInPolygon,
} from './useTurbulenceOverlay';

const SQUARE_ADVISORY = {
  advisory_id: 'T1',
  hazard: 'TURB-HI',
  severity: 'MOD',
  lower_alt_ft: 18000,
  upper_alt_ft: 42000,
  polygon: {
    type: 'Polygon',
    coordinates: [[[-101, 39], [-99, 39], [-99, 41], [-101, 41], [-101, 39]]],
  },
};

describe('useTurbulenceOverlay helpers', () => {
  it('getTurbulenceSeverity maps by intensity, not altitude band', () => {
    // hazard TURB-HI/LO is an altitude band, not an intensity → severity field wins.
    expect(getTurbulenceSeverity({ hazard: 'TURB-HI', severity: 'SEV' }).label).toBe('Severe');
    expect(getTurbulenceSeverity({ hazard: 'TURB-HI', severity: 'MOD' }).label).toBe('Moderate');
    expect(getTurbulenceSeverity({ severity: 'MOD' }).label).toBe('Moderate');
    expect(getTurbulenceSeverity({ severity: 'LGT' }).label).toBe('Light');
    expect(getTurbulenceSeverity({ hazard: 'TURB-HI' }).label).toBe('Turbulence');
  });

  it('parseAdvisoryCoords parses GeoJSON polygon', () => {
    const coords = parseAdvisoryCoords(SQUARE_ADVISORY);
    expect(coords[0]).toEqual({ lat: 39, lon: -101 });
  });

  it('isPointInPolygon ray-casts correctly', () => {
    const poly = [
      { lat: 39, lon: -101 },
      { lat: 39, lon: -99 },
      { lat: 41, lon: -99 },
      { lat: 41, lon: -101 },
    ];
    expect(isPointInPolygon(40, -100, poly)).toBe(true);
    expect(isPointInPolygon(50, -100, poly)).toBe(false);
  });
});

describe('useTurbulenceOverlay', () => {
  it('filters advisories to the TURB slice', () => {
    const advisories = [SQUARE_ADVISORY, { advisory_id: 'I1', hazard: 'ICE', polygon: SQUARE_ADVISORY.polygon }];
    const { result } = renderHook(() => useTurbulenceOverlay({ enabled: true, advisories }));
    expect(result.current.count).toBe(1);
    expect(result.current.turbulenceAreas[0].hazard).toBe('TURB-HI');
  });

  it('returns empty when disabled', () => {
    const { result } = renderHook(() =>
      useTurbulenceOverlay({ enabled: false, advisories: [SQUARE_ADVISORY] })
    );
    expect(result.current.count).toBe(0);
  });

  it('getTurbulenceAtPoint hits inside, misses outside', () => {
    const { result } = renderHook(() =>
      useTurbulenceOverlay({ enabled: true, advisories: [SQUARE_ADVISORY] })
    );
    expect(result.current.getTurbulenceAtPoint(40, -100)?.id).toBe('T1');
    expect(result.current.getTurbulenceAtPoint(0, 0)).toBeNull();
  });

  it('drawOnCanvas paints into a mock ctx', () => {
    const { result } = renderHook(() =>
      useTurbulenceOverlay({ enabled: true, advisories: [SQUARE_ADVISORY] })
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
      measureText: () => ({ width: 40 }),
      fillText: vi.fn(),
    };
    const toScreen = (lat, lon) => ({ x: (lon + 101) * 100, y: (41 - lat) * 100 });
    result.current.drawOnCanvas(ctx, toScreen, 1);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });
});
