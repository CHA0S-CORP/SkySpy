import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { CanvasRadar } from './CanvasRadar';

// Mock 2D context mirroring the real Canvas API (which has createConicGradient,
// NOT createConicalGradient — calling the latter throws in a real browser)
const createMockCtx = () => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  fillText: vi.fn(),
  setLineDash: vi.fn(),
  scale: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: '',
  globalAlpha: 1,
});

describe('CanvasRadar', () => {
  let mockCtx;
  let rafCallbacks;
  let originalGetContext;

  beforeEach(() => {
    mockCtx = createMockCtx();
    rafCallbacks = [];
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.unstubAllGlobals();
  });

  const runNextFrame = (timestamp) => {
    const cb = rafCallbacks.shift();
    if (cb) cb(timestamp);
  };

  const threats = [
    { icao: 'ABC123', distance_nm: 5, bearing: 90, threat_level: 'warning' },
    { icao: 'DEF456', distance_nm: 10, bearing: 180, threat_level: 'critical' },
  ];

  it('renders a canvas element', () => {
    const { container } = render(<CanvasRadar threats={threats} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('does not crash drawing the sweep with default props (sweepEnabled)', () => {
    render(<CanvasRadar threats={threats} />);

    // First animation frame must not throw (regression: ctx.createConicalGradient
    // is not a real Canvas 2D API and killed the animation loop on frame 1)
    expect(() => runNextFrame(16)).not.toThrow();

    // The loop must re-arm for the next frame
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });

  it('draws threat blips after the sweep on each frame', () => {
    render(<CanvasRadar threats={threats} />);

    runNextFrame(16);

    // Blips + rings + markers all draw arcs; fill must have been reached
    expect(mockCtx.arc).toHaveBeenCalled();
    expect(mockCtx.fill).toHaveBeenCalled();

    // Loop keeps running across multiple frames
    expect(() => runNextFrame(32)).not.toThrow();
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });

  it('cancels the animation loop on unmount', () => {
    const { unmount } = render(<CanvasRadar threats={threats} />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
