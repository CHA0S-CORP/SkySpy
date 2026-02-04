import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import PropTypes from 'prop-types';

/**
 * RadarScope component
 *
 * A single radar scope canvas that can render aircraft and overlays.
 * This component is designed to be used within MultiScopeContainer for
 * multi-scope layouts, or standalone for single-scope mode.
 *
 * The actual radar drawing logic remains in MapView for now - this component
 * provides the canvas infrastructure and scope-specific settings.
 *
 * In a future refactor, the drawing logic from MapView's useEffect (lines ~3917-6800)
 * can be extracted into this component for cleaner separation.
 */
const RadarScope = forwardRef(function RadarScope(
  {
    // Scope configuration
    scopeId = 1,
    range = 50,
    panOffset = { x: 0, y: 0 },
    center = null, // Custom center point { lat, lon } - null means use feeder location

    // Data
    aircraft = [],
    feederLocation,
    selectedAircraft = null,

    // Display settings
    isPro = true,
    themeColors = null,
    showGrid = true,
    showCompassRose = true,
    showRangeRings = true,
    showDataBlocks = true,
    showPredictionVectors = true,
    showShortTracks = false,

    // Event handlers
    onAircraftClick,
    onAircraftHover,
    onPanChange,
    onRangeChange,
    onCanvasClick,
    onCanvasDoubleClick,

    // Additional props
    className = '',
    style = {},

    // Debug
    debug = false,
  },
  ref
) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);

  // Expose canvas ref and methods to parent
  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => canvasRef.current,
      getContainer: () => containerRef.current,
      getContext: () => canvasRef.current?.getContext('2d'),
      getScopeId: () => scopeId,
      getRange: () => range,
      getPanOffset: () => panOffset,
      getCenter: () => center,
    }),
    [scopeId, range, panOffset, center]
  );

  // Calculate effective center (custom center or feeder location)
  const effectiveCenter = useMemo(() => {
    if (center && center.lat != null && center.lon != null) {
      return center;
    }
    return feederLocation;
  }, [center, feederLocation]);

  // Handle canvas resize
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Mouse wheel zoom handler
  const handleWheel = useCallback(
    (e) => {
      if (!onRangeChange) return;

      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      const step = range >= 100 ? 25 : 10;
      const newRange = Math.max(5, Math.min(500, range + delta * step));
      onRangeChange(scopeId, newRange);
    },
    [range, scopeId, onRangeChange]
  );

  // Pan handling
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  const handleMouseDown = useCallback(
    (e) => {
      // Middle mouse button or Ctrl+left click for panning
      if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        isPanning.current = true;
        panStart.current = {
          x: e.clientX,
          y: e.clientY,
          offsetX: panOffset.x,
          offsetY: panOffset.y,
        };
      }
    },
    [panOffset]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!isPanning.current || !onPanChange) return;

      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;

      onPanChange(scopeId, {
        x: panStart.current.offsetX + dx,
        y: panStart.current.offsetY + dy,
      });
    },
    [scopeId, onPanChange]
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Set up mouse event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleWheel, handleMouseDown, handleMouseMove, handleMouseUp]);

  // Handle click events
  const handleClick = useCallback(
    (e) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Calculate position relative to center with pan offset
      const adjustedX = clickX - panOffset.x;
      const adjustedY = clickY - panOffset.y;

      if (onCanvasClick) {
        onCanvasClick({
          scopeId,
          x: clickX,
          y: clickY,
          centerX,
          centerY,
          adjustedX: adjustedX - centerX,
          adjustedY: adjustedY - centerY,
          range,
        });
      }
    },
    [scopeId, panOffset, range, onCanvasClick]
  );

  const handleDoubleClick = useCallback(
    (e) => {
      if (!canvasRef.current || !onCanvasDoubleClick) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      onCanvasDoubleClick({
        scopeId,
        x: clickX,
        y: clickY,
        range,
      });
    },
    [scopeId, range, onCanvasDoubleClick]
  );

  // Debug overlay
  const renderDebugInfo = () => {
    if (!debug) return null;

    return (
      <div className="scope-debug-overlay">
        <div>Scope: {scopeId}</div>
        <div>Range: {range}nm</div>
        <div>
          Pan: {panOffset.x.toFixed(0)}, {panOffset.y.toFixed(0)}
        </div>
        <div>
          Center: {effectiveCenter?.lat?.toFixed(4)}, {effectiveCenter?.lon?.toFixed(4)}
        </div>
        <div>Aircraft: {aircraft.length}</div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`radar-scope-container ${isPro ? 'pro-mode' : ''} ${className}`}
      style={style}
    >
      <canvas
        ref={canvasRef}
        className="radar-scope-canvas"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          cursor: isPanning.current ? 'grabbing' : 'grab',
        }}
      />

      {/* Scope label (for multi-scope mode) */}
      <div className="scope-label">
        <span className="scope-label-id">S{scopeId}</span>
        <span className="scope-label-range">{range}nm</span>
      </div>

      {renderDebugInfo()}
    </div>
  );
});

RadarScope.propTypes = {
  // Scope configuration
  scopeId: PropTypes.number,
  range: PropTypes.number,
  panOffset: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  center: PropTypes.shape({
    lat: PropTypes.number,
    lon: PropTypes.number,
  }),

  // Data
  aircraft: PropTypes.array,
  feederLocation: PropTypes.shape({
    lat: PropTypes.number,
    lon: PropTypes.number,
  }),
  selectedAircraft: PropTypes.object,

  // Display settings
  isPro: PropTypes.bool,
  themeColors: PropTypes.object,
  showGrid: PropTypes.bool,
  showCompassRose: PropTypes.bool,
  showRangeRings: PropTypes.bool,
  showDataBlocks: PropTypes.bool,
  showPredictionVectors: PropTypes.bool,
  showShortTracks: PropTypes.bool,

  // Event handlers
  onAircraftClick: PropTypes.func,
  onAircraftHover: PropTypes.func,
  onPanChange: PropTypes.func,
  onRangeChange: PropTypes.func,
  onCanvasClick: PropTypes.func,
  onCanvasDoubleClick: PropTypes.func,

  // Additional props
  className: PropTypes.string,
  style: PropTypes.object,

  // Debug
  debug: PropTypes.bool,
};

/**
 * Hook to coordinate multiple RadarScope instances
 * Manages shared state like selected aircraft across synced scopes
 */
export function useRadarScopeCoordinator({ scopes, syncSelection = true, onScopeChange }) {
  const scopeRefs = useRef({});

  const registerScope = useCallback((scopeId, ref) => {
    scopeRefs.current[scopeId] = ref;
  }, []);

  const unregisterScope = useCallback((scopeId) => {
    delete scopeRefs.current[scopeId];
  }, []);

  const broadcastSelection = useCallback(
    (selectedAircraft) => {
      if (!syncSelection) return;

      Object.values(scopeRefs.current).forEach((ref) => {
        if (ref?.setSelectedAircraft) {
          ref.setSelectedAircraft(selectedAircraft);
        }
      });
    },
    [syncSelection]
  );

  return {
    registerScope,
    unregisterScope,
    broadcastSelection,
    scopeRefs: scopeRefs.current,
  };
}

export { RadarScope };
export default RadarScope;
