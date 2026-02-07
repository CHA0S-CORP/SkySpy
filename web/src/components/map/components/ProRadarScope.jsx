import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  memo,
} from 'react';
import PropTypes from 'prop-types';

/**
 * ProRadarScope - A single radar scope for multi-scope Pro Mode layouts
 *
 * This component renders a complete radar scope with:
 * - Canvas-based aircraft rendering
 * - Independent pan offset and range
 * - Range rings, compass rose, and grid
 * - Data blocks and prediction vectors
 *
 * Key features:
 * - Each scope can have its own center point and range
 * - Shares aircraft data with other scopes
 * - Supports linked or independent selection across scopes
 *
 * Phase 14.1: Multi-Scope View for Pro Mode
 */
const ProRadarScope = memo(
  forwardRef(function ProRadarScope(
    {
      // Scope identity
      scopeId = 1,
      isActive = false,

      // Scope configuration
      range = 50,
      panOffset = { x: 0, y: 0 },
      center = null, // Custom center { lat, lon } - null means use feeder

      // Data
      aircraft = [],
      feederLocation = { lat: 47.9377, lon: -121.9687 },
      selectedAircraft = null,

      // Display settings
      themeColors = null,
      showGrid = true,
      showCompassRose = true,
      showRangeRings = true,
      showDataBlocks = true,
      showPredictionVectors = true,
      showShortTracks = false,
      showSpeedColoring = false,
      showVerticalSpeedTrend = true,
      predictionMinutes = 1,
      shortTrackLength = 15,
      gridOpacity = 1,

      // Event handlers
      onAircraftClick,
      onAircraftHover: _onAircraftHover,
      onPanChange,
      onRangeChange,
      onActivate,
      onCanvasDoubleClick,

      // Additional props
      className = '',
    },
    ref
  ) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const animationRef = useRef(null);
    const lastRenderRef = useRef(0);

    // Pan state
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

    // Default theme colors for Pro mode
    const colors = useMemo(
      () =>
        themeColors || {
          background: '#0a0d12',
          grid: 'rgba(60, 100, 140, 0.15)',
          rangeRing: 'rgba(80, 140, 200, 0.4)',
          rangeRingText: 'rgba(100, 160, 200, 0.6)',
          compassRose: 'rgba(100, 180, 255, 0.5)',
          aircraftDefault: 'rgba(80, 200, 255, 0.9)',
          aircraftMilitary: 'rgba(255, 180, 60, 0.9)',
          aircraftEmergency: 'rgba(255, 80, 80, 1)',
          aircraftSelected: 'rgba(255, 255, 100, 1)',
          aircraftGround: 'rgba(100, 150, 180, 0.5)',
          dataBlock: 'rgba(150, 210, 255, 0.85)',
          dataBlockBg: 'rgba(10, 20, 30, 0.7)',
          predictionVector: 'rgba(80, 200, 255, 0.5)',
          shortTrack: 'rgba(80, 200, 255, 0.3)',
          feederMarker: 'rgba(100, 255, 180, 0.8)',
        },
      [themeColors]
    );

    // Effective center point (custom or feeder)
    const effectiveCenter = useMemo(() => {
      if (center && center.lat != null && center.lon != null) {
        return center;
      }
      return feederLocation;
    }, [center, feederLocation]);

    // Expose ref methods
    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        getContainer: () => containerRef.current,
        getScopeId: () => scopeId,
        getRange: () => range,
        getPanOffset: () => panOffset,
        getCenter: () => effectiveCenter,
        redraw: () => drawScope(),
      }),
      [scopeId, range, panOffset, effectiveCenter]
    );

    // Convert lat/lon to screen position
    const latLonToScreen = useCallback(
      (lat, lon, canvasWidth, canvasHeight) => {
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const maxRadius = Math.min(canvasWidth, canvasHeight) * 0.45;
        const pixelsPerNm = maxRadius / range;

        const dLat = lat - effectiveCenter.lat;
        const dLon = lon - effectiveCenter.lon;
        const nmY = dLat * 60;
        const nmX = dLon * 60 * Math.cos((effectiveCenter.lat * Math.PI) / 180);

        return {
          x: centerX + nmX * pixelsPerNm + panOffset.x,
          y: centerY - nmY * pixelsPerNm + panOffset.y,
        };
      },
      [range, effectiveCenter, panOffset]
    );

    // Get distance in nm from center
    const getDistanceNm = useCallback(
      (lat, lon) => {
        const dLat = lat - effectiveCenter.lat;
        const dLon = lon - effectiveCenter.lon;
        const nmY = dLat * 60;
        const nmX = dLon * 60 * Math.cos((effectiveCenter.lat * Math.PI) / 180);
        return Math.sqrt(nmX * nmX + nmY * nmY);
      },
      [effectiveCenter]
    );

    // Main drawing function
    const drawScope = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      // Resize canvas if needed
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
      }

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(width, height) * 0.45;
      const pixelsPerNm = maxRadius / range;

      // Clear with background
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, width, height);

      // Draw grid
      if (showGrid && gridOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = gridOpacity * 0.15;
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;

        const gridSpacing = 30;
        for (let x = (centerX + panOffset.x) % gridSpacing; x < width; x += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = (centerY + panOffset.y) % gridSpacing; y < height; y += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw range rings
      if (showRangeRings) {
        const ringIntervals =
          range <= 25
            ? [5, 10, 15, 20, 25]
            : range <= 50
              ? [10, 25, 50]
              : range <= 100
                ? [25, 50, 75, 100]
                : range <= 250
                  ? [50, 100, 150, 200, 250]
                  : [100, 200, 300, 400, 500];

        ctx.strokeStyle = colors.rangeRing;
        ctx.fillStyle = colors.rangeRingText;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 1;

        ringIntervals.forEach((nm) => {
          if (nm > range) return;
          const r = nm * pixelsPerNm;
          ctx.beginPath();
          ctx.arc(centerX + panOffset.x, centerY + panOffset.y, r, 0, Math.PI * 2);
          ctx.stroke();
          // Ring label
          ctx.fillText(`${nm}`, centerX + panOffset.x, centerY + panOffset.y - r - 4);
        });
      }

      // Draw compass rose
      if (showCompassRose) {
        ctx.save();
        ctx.strokeStyle = colors.compassRose;
        ctx.fillStyle = colors.compassRose;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;

        const cardinals = [
          { label: 'N', angle: 0 },
          { label: 'E', angle: 90 },
          { label: 'S', angle: 180 },
          { label: 'W', angle: 270 },
        ];

        const compassRadius = maxRadius + 15;
        cardinals.forEach(({ label, angle }) => {
          const rad = ((angle - 90) * Math.PI) / 180;
          const x = centerX + panOffset.x + Math.cos(rad) * compassRadius;
          const y = centerY + panOffset.y + Math.sin(rad) * compassRadius;
          ctx.fillText(label, x, y);

          // Tick mark
          const tickStart = compassRadius - 8;
          const tickEnd = compassRadius - 3;
          ctx.beginPath();
          ctx.moveTo(
            centerX + panOffset.x + Math.cos(rad) * tickStart,
            centerY + panOffset.y + Math.sin(rad) * tickStart
          );
          ctx.lineTo(
            centerX + panOffset.x + Math.cos(rad) * tickEnd,
            centerY + panOffset.y + Math.sin(rad) * tickEnd
          );
          ctx.stroke();
        });
        ctx.restore();
      }

      // Draw feeder marker
      const feederPos = latLonToScreen(feederLocation.lat, feederLocation.lon, width, height);
      ctx.save();
      ctx.fillStyle = colors.feederMarker;
      ctx.beginPath();
      ctx.arc(feederPos.x, feederPos.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors.feederMarker;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(feederPos.x, feederPos.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Filter aircraft within range
      const visibleAircraft = aircraft.filter((ac) => {
        if (!ac.lat || !ac.lon) return false;
        const dist = getDistanceNm(ac.lat, ac.lon);
        return dist <= range * 1.2; // Slight buffer for edge aircraft
      });

      // Draw short tracks
      if (showShortTracks) {
        ctx.save();
        ctx.strokeStyle = colors.shortTrack;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;

        visibleAircraft.forEach((ac) => {
          if (!ac.positions || ac.positions.length < 2) return;

          const trackPoints = ac.positions.slice(-shortTrackLength);
          ctx.beginPath();
          trackPoints.forEach((pos, i) => {
            const screenPos = latLonToScreen(pos.lat, pos.lon, width, height);
            if (i === 0) {
              ctx.moveTo(screenPos.x, screenPos.y);
            } else {
              ctx.lineTo(screenPos.x, screenPos.y);
            }
          });
          ctx.stroke();
        });
        ctx.restore();
      }

      // Draw aircraft
      visibleAircraft.forEach((ac) => {
        const pos = latLonToScreen(ac.lat, ac.lon, width, height);
        const isSelected = selectedAircraft?.hex === ac.hex;
        const isGround = (ac.alt || 0) === 0 && (ac.gs || 0) < 30;
        const isEmergency = ac.squawk === '7500' || ac.squawk === '7600' || ac.squawk === '7700';
        const isMilitary = ac.military || ac.category === 'A5';

        // Determine aircraft color
        let acColor = colors.aircraftDefault;
        if (isSelected) acColor = colors.aircraftSelected;
        else if (isEmergency) acColor = colors.aircraftEmergency;
        else if (isMilitary) acColor = colors.aircraftMilitary;
        else if (isGround) acColor = colors.aircraftGround;
        else if (showSpeedColoring && ac.gs) {
          // Speed coloring
          const speed = ac.gs;
          if (speed < 100) acColor = 'rgba(100, 200, 100, 0.9)';
          else if (speed < 250) acColor = 'rgba(100, 200, 255, 0.9)';
          else if (speed < 400) acColor = 'rgba(255, 200, 100, 0.9)';
          else acColor = 'rgba(255, 100, 100, 0.9)';
        }

        // Draw prediction vector
        if (showPredictionVectors && ac.track != null && ac.gs) {
          ctx.save();
          ctx.strokeStyle = colors.predictionVector;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.6;

          const nmPerMinute = ac.gs / 60;
          const vectorNm = nmPerMinute * predictionMinutes;
          const rad = ((ac.track - 90) * Math.PI) / 180;
          const vectorX = Math.cos(rad) * vectorNm * pixelsPerNm;
          const vectorY = Math.sin(rad) * vectorNm * pixelsPerNm;

          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(pos.x + vectorX, pos.y + vectorY);
          ctx.stroke();
          ctx.restore();
        }

        // Draw aircraft symbol
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(((ac.track || 0) * Math.PI) / 180);

        ctx.fillStyle = acColor;
        ctx.strokeStyle = isSelected ? colors.aircraftSelected : 'rgba(0,0,0,0.3)';
        ctx.lineWidth = isSelected ? 2 : 1;

        // Simple arrow shape
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5, 6);
        ctx.lineTo(0, 3);
        ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.fill();
        if (isSelected) ctx.stroke();

        ctx.restore();

        // Draw vertical speed trend triangles
        if (showVerticalSpeedTrend && ac.baro_rate) {
          const vsTrendSize = 4;
          ctx.save();
          ctx.fillStyle =
            ac.baro_rate > 300
              ? 'rgba(100, 255, 100, 0.8)'
              : ac.baro_rate < -300
                ? 'rgba(255, 100, 100, 0.8)'
                : 'transparent';

          if (Math.abs(ac.baro_rate) > 300) {
            ctx.beginPath();
            if (ac.baro_rate > 0) {
              // Up triangle
              ctx.moveTo(pos.x + 12, pos.y - vsTrendSize);
              ctx.lineTo(pos.x + 12 + vsTrendSize, pos.y + vsTrendSize);
              ctx.lineTo(pos.x + 12 - vsTrendSize, pos.y + vsTrendSize);
            } else {
              // Down triangle
              ctx.moveTo(pos.x + 12, pos.y + vsTrendSize);
              ctx.lineTo(pos.x + 12 + vsTrendSize, pos.y - vsTrendSize);
              ctx.lineTo(pos.x + 12 - vsTrendSize, pos.y - vsTrendSize);
            }
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }

        // Draw data block
        if (showDataBlocks && !isGround) {
          const callsign = ac.flight?.trim() || ac.hex.toUpperCase();
          const altitude = ac.alt
            ? Math.round(ac.alt / 100)
                .toString()
                .padStart(3, '0')
            : '---';
          const speed = ac.gs ? Math.round(ac.gs).toString() : '---';

          const labelX = pos.x + 15;
          const labelY = pos.y - 15;

          ctx.save();
          ctx.font = '10px "JetBrains Mono", monospace';

          // Background
          const textWidth = Math.max(
            ctx.measureText(callsign).width,
            ctx.measureText(`${altitude} ${speed}`).width
          );
          ctx.fillStyle = colors.dataBlockBg;
          ctx.fillRect(labelX - 2, labelY - 10, textWidth + 6, 24);

          // Text
          ctx.fillStyle = isSelected ? colors.aircraftSelected : colors.dataBlock;
          ctx.fillText(callsign, labelX, labelY);
          ctx.fillText(`${altitude} ${speed}`, labelX, labelY + 11);
          ctx.restore();
        }
      });

      // Draw scope info overlay
      ctx.save();
      ctx.fillStyle = 'rgba(100, 160, 200, 0.5)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`S${scopeId} | ${range}nm | ${visibleAircraft.length} ac`, 8, height - 8);
      ctx.restore();
    }, [
      aircraft,
      colors,
      effectiveCenter,
      feederLocation,
      getDistanceNm,
      gridOpacity,
      latLonToScreen,
      panOffset,
      predictionMinutes,
      range,
      scopeId,
      selectedAircraft,
      shortTrackLength,
      showCompassRose,
      showDataBlocks,
      showGrid,
      showPredictionVectors,
      showRangeRings,
      showShortTracks,
      showSpeedColoring,
      showVerticalSpeedTrend,
    ]);

    // Animation loop
    useEffect(() => {
      let running = true;

      const animate = () => {
        if (!running) return;

        const now = performance.now();
        if (now - lastRenderRef.current > 50) {
          // ~20fps for inactive scopes
          drawScope();
          lastRenderRef.current = now;
        }

        animationRef.current = requestAnimationFrame(animate);
      };

      animate();

      return () => {
        running = false;
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [drawScope]);

    // Pan handling
    const handleMouseDown = useCallback(
      (e) => {
        // Middle mouse or Ctrl+left click to pan
        if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          isPanningRef.current = true;
          panStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            offsetX: panOffset.x,
            offsetY: panOffset.y,
          };
        }
        // Activate this scope on any click
        if (onActivate && !isActive) {
          onActivate(scopeId);
        }
      },
      [panOffset, onActivate, isActive, scopeId]
    );

    const handleMouseMove = useCallback(
      (e) => {
        if (!isPanningRef.current || !onPanChange) return;

        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;

        onPanChange(scopeId, {
          x: panStartRef.current.offsetX + dx,
          y: panStartRef.current.offsetY + dy,
        });
      },
      [scopeId, onPanChange]
    );

    const handleMouseUp = useCallback(() => {
      isPanningRef.current = false;
    }, []);

    // Wheel zoom
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

    // Double click to center
    const handleDoubleClick = useCallback(
      (e) => {
        if (!onCanvasDoubleClick) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // Calculate new pan offset to center on click point
        const newPanX = -(clickX - centerX - panOffset.x);
        const newPanY = -(clickY - centerY - panOffset.y);

        onCanvasDoubleClick({
          scopeId,
          panOffset: { x: newPanX, y: newPanY },
        });
      },
      [scopeId, panOffset, onCanvasDoubleClick]
    );

    // Click handler for aircraft selection
    const handleClick = useCallback(
      (e) => {
        if (!canvasRef.current || !onAircraftClick) return;
        if (isPanningRef.current) return; // Don't select during pan

        const rect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Find closest aircraft
        let closest = null;
        let closestDist = 25; // Click threshold in pixels

        aircraft.forEach((ac) => {
          if (!ac.lat || !ac.lon) return;
          const dist = getDistanceNm(ac.lat, ac.lon);
          if (dist > range * 1.2) return;

          const pos = latLonToScreen(ac.lat, ac.lon, rect.width, rect.height);
          const d = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
          if (d < closestDist) {
            closestDist = d;
            closest = ac;
          }
        });

        onAircraftClick(closest);
      },
      [aircraft, getDistanceNm, latLonToScreen, onAircraftClick, range]
    );

    // Set up event listeners
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.addEventListener('wheel', handleWheel, { passive: false });
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        canvas.removeEventListener('wheel', handleWheel);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }, [handleWheel, handleMouseMove, handleMouseUp]);

    return (
      <div
        ref={containerRef}
        className={`pro-radar-scope ${isActive ? 'active' : ''} ${className}`}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          className="pro-radar-scope-canvas"
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            cursor: isPanningRef.current ? 'grabbing' : 'grab',
          }}
        />
      </div>
    );
  })
);

ProRadarScope.propTypes = {
  scopeId: PropTypes.number,
  isActive: PropTypes.bool,
  range: PropTypes.number,
  panOffset: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  center: PropTypes.shape({
    lat: PropTypes.number,
    lon: PropTypes.number,
  }),
  aircraft: PropTypes.array,
  feederLocation: PropTypes.shape({
    lat: PropTypes.number,
    lon: PropTypes.number,
  }),
  selectedAircraft: PropTypes.object,
  themeColors: PropTypes.object,
  showGrid: PropTypes.bool,
  showCompassRose: PropTypes.bool,
  showRangeRings: PropTypes.bool,
  showDataBlocks: PropTypes.bool,
  showPredictionVectors: PropTypes.bool,
  showShortTracks: PropTypes.bool,
  showSpeedColoring: PropTypes.bool,
  showVerticalSpeedTrend: PropTypes.bool,
  predictionMinutes: PropTypes.number,
  shortTrackLength: PropTypes.number,
  gridOpacity: PropTypes.number,
  onAircraftClick: PropTypes.func,
  onAircraftHover: PropTypes.func,
  onPanChange: PropTypes.func,
  onRangeChange: PropTypes.func,
  onActivate: PropTypes.func,
  onCanvasDoubleClick: PropTypes.func,
  className: PropTypes.string,
};

export { ProRadarScope };
export default ProRadarScope;
