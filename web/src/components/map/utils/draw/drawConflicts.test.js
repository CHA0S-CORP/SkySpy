import { describe, it, expect, vi } from 'vitest';
import { drawConflictWedges, buildConflictAircraftSet } from './drawConflicts';

function createMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

const geo = {
  width: 800,
  height: 600,
  isPro: true,
  radarRange: 50,
  latLonToScreen: vi.fn(() => ({ x: 400, y: 300 })),
};

describe('buildConflictAircraftSet', () => {
  it('collects both aircraft hexes uppercased', () => {
    const set = buildConflictAircraftSet([{ icao: 'abc123', icao_2: 'def456' }]);
    expect(set).toEqual(new Set(['ABC123', 'DEF456']));
  });
});

describe('drawConflictWedges', () => {
  const activeConflicts = [{ icao: 'ABC123', icao_2: 'DEF456', severity: 'warning' }];
  const conflictAircraft = new Set(['ABC123', 'DEF456']);

  it('draws a wedge for a northbound aircraft with track === 0', () => {
    const ctx = createMockCtx();
    const sortedAircraft = [{ hex: 'ABC123', lat: 40, lon: -75, track: 0, gs: 400 }];

    drawConflictWedges(ctx, geo, {
      showConflictVisualization: true,
      activeConflicts,
      sortedAircraft,
      conflictAircraft,
    });

    // track=0 (due north) is valid — the wedge must be rendered
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('skips aircraft with missing track', () => {
    const ctx = createMockCtx();
    const sortedAircraft = [{ hex: 'ABC123', lat: 40, lon: -75, track: null, gs: 400 }];

    drawConflictWedges(ctx, geo, {
      showConflictVisualization: true,
      activeConflicts,
      sortedAircraft,
      conflictAircraft,
    });

    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('skips aircraft with missing coordinates', () => {
    const ctx = createMockCtx();
    const sortedAircraft = [{ hex: 'ABC123', lat: null, lon: null, track: 90, gs: 400 }];

    drawConflictWedges(ctx, geo, {
      showConflictVisualization: true,
      activeConflicts,
      sortedAircraft,
      conflictAircraft,
    });

    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('does nothing when visualization is disabled', () => {
    const ctx = createMockCtx();
    drawConflictWedges(ctx, geo, {
      showConflictVisualization: false,
      activeConflicts,
      sortedAircraft: [{ hex: 'ABC123', lat: 40, lon: -75, track: 0, gs: 400 }],
      conflictAircraft,
    });

    expect(ctx.save).not.toHaveBeenCalled();
  });
});
