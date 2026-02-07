import React, { useEffect, useRef, useCallback, memo } from 'react';
import { drawHeatMap, HEAT_MAP_TIME_PERIODS, HEAT_MAP_GRID_SIZES } from '../../../hooks/useHeatMap';

/**
 * HeatMapLayer - Canvas overlay for traffic density heat map visualization
 *
 * Renders a heat map showing traffic density patterns over time.
 * Useful for antenna optimization and coverage analysis.
 */
export const HeatMapLayer = memo(function HeatMapLayer({
  enabled,
  heatMapData,
  bounds,
  width,
  height,
  latLonToScreen,
  stats,
  loading,
  error,
  timePeriod,
  setTimePeriod,
  gridSize,
  setGridSize,
  opacity = 0.7,
  setOpacity,
  hideAircraft = false,
  setHideAircraft,
  onRefresh,
  onClear,
  themeColors,
}) {
  const canvasRef = useRef(null);

  // Draw heat map to canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatMapData || !bounds || !latLonToScreen) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (!enabled || heatMapData.length === 0) return;

    // Calculate screen bounds from geographic bounds
    const topLeft = latLonToScreen(bounds.maxLat, bounds.minLon);
    const bottomRight = latLonToScreen(bounds.minLat, bounds.maxLon);

    const screenWidth = bottomRight.x - topLeft.x;
    const screenHeight = bottomRight.y - topLeft.y;

    // Skip if bounds are inverted or too small
    if (screenWidth <= 0 || screenHeight <= 0) return;

    // Create offscreen canvas for heat map
    const offscreen = document.createElement('canvas');
    offscreen.width = heatMapData[0]?.length || 50;
    offscreen.height = heatMapData.length;
    const offCtx = offscreen.getContext('2d');

    // Draw heat map to offscreen canvas at native grid resolution
    drawHeatMap(offCtx, heatMapData, offscreen.width, offscreen.height, {
      opacity: opacity,
      blur: false, // We'll apply blur when scaling up
      minOpacity: 0.05,
    });

    // Draw scaled heat map to main canvas with blur
    ctx.save();
    ctx.filter = 'blur(8px)';
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = opacity;
    ctx.drawImage(offscreen, topLeft.x, topLeft.y, screenWidth, screenHeight);
    ctx.restore();

    // Draw a second pass with less blur for sharper hot spots
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.globalAlpha = opacity * 0.5;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(offscreen, topLeft.x, topLeft.y, screenWidth, screenHeight);
    ctx.restore();
  }, [enabled, heatMapData, bounds, width, height, latLonToScreen, opacity]);

  // Redraw when dependencies change
  useEffect(() => {
    draw();
  }, [draw]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    draw();
  }, [width, height, draw]);

  if (!enabled) return null;

  // Get theme-aware colors
  const panelBg = themeColors?.bg?.() || 'rgba(10, 15, 20, 0.95)';
  const textColor = themeColors?.rgba?.('primary', 0.9) || 'rgba(100, 200, 255, 0.9)';
  const dimTextColor = themeColors?.rgba?.('primary', 0.6) || 'rgba(100, 200, 255, 0.6)';
  const borderColor = themeColors?.rgba?.('primary', 0.3) || 'rgba(100, 200, 255, 0.3)';

  return (
    <>
      {/* Heat map canvas overlay */}
      <canvas
        ref={canvasRef}
        className="heat-map-canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />

      {/* Heat map control panel */}
      <div
        className="heat-map-panel"
        style={{
          position: 'absolute',
          top: 60,
          right: 16,
          backgroundColor: panelBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '8px',
          padding: '12px',
          minWidth: '200px',
          zIndex: 1000,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '12px',
          color: textColor,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            borderBottom: `1px solid ${borderColor}`,
            paddingBottom: '8px',
          }}
        >
          <span style={{ fontWeight: 'bold' }}>Heat Map</span>
          {loading && <span style={{ color: dimTextColor }}>Loading...</span>}
        </div>

        {error && (
          <div
            style={{
              color: '#ff6b6b',
              marginBottom: '8px',
              fontSize: '11px',
            }}
          >
            {error}
          </div>
        )}

        {/* Time period selector */}
        <div style={{ marginBottom: '10px' }}>
          <label
            htmlFor="heatmap-time-period"
            style={{ display: 'block', marginBottom: '4px', color: dimTextColor }}
          >
            Time Period
          </label>
          <select
            id="heatmap-time-period"
            value={timePeriod}
            onChange={(e) => setTimePeriod(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: `1px solid ${borderColor}`,
              borderRadius: '4px',
              color: textColor,
              fontFamily: 'inherit',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            {HEAT_MAP_TIME_PERIODS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Grid resolution selector */}
        <div style={{ marginBottom: '10px' }}>
          <label
            htmlFor="heatmap-resolution"
            style={{ display: 'block', marginBottom: '4px', color: dimTextColor }}
          >
            Resolution
          </label>
          <select
            id="heatmap-resolution"
            value={gridSize}
            onChange={(e) => setGridSize(parseInt(e.target.value, 10))}
            style={{
              width: '100%',
              padding: '6px 8px',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: `1px solid ${borderColor}`,
              borderRadius: '4px',
              color: textColor,
              fontFamily: 'inherit',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            {HEAT_MAP_GRID_SIZES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Opacity/Intensity slider */}
        <div style={{ marginBottom: '10px' }}>
          <label
            htmlFor="heatmap-opacity"
            style={{ display: 'block', marginBottom: '4px', color: dimTextColor }}
          >
            Intensity: {Math.round(opacity * 100)}%
          </label>
          <input
            id="heatmap-opacity"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity?.(parseFloat(e.target.value))}
            style={{
              width: '100%',
              height: '6px',
              appearance: 'none',
              background: `linear-gradient(to right, ${borderColor}, ${textColor})`,
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Hide aircraft toggle */}
        <div style={{ marginBottom: '10px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              color: textColor,
            }}
          >
            <input
              type="checkbox"
              checked={hideAircraft}
              onChange={(e) => setHideAircraft?.(e.target.checked)}
              style={{
                width: '14px',
                height: '14px',
                cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: '11px' }}>Hide aircraft symbols</span>
          </label>
        </div>

        {/* Statistics */}
        {stats && stats.totalPositions > 0 && (
          <div
            style={{
              borderTop: `1px solid ${borderColor}`,
              paddingTop: '10px',
              marginTop: '10px',
            }}
          >
            <div style={{ marginBottom: '6px' }}>
              <span style={{ color: dimTextColor }}>Positions:</span>{' '}
              <span>{stats.totalPositions.toLocaleString()}</span>
            </div>
            <div style={{ marginBottom: '6px' }}>
              <span style={{ color: dimTextColor }}>Coverage:</span>{' '}
              <span>{stats.coveragePercent}%</span>
            </div>
            {stats.peakCell && (
              <div style={{ marginBottom: '6px' }}>
                <span style={{ color: dimTextColor }}>Peak:</span>{' '}
                <span>
                  {stats.peakCell.count} @ {stats.peakCell.distanceNm}nm / {stats.peakCell.bearing}
                  &deg;
                </span>
              </div>
            )}
            {stats.lastUpdated && (
              <div style={{ color: dimTextColor, fontSize: '10px' }}>
                Updated: {new Date(stats.lastUpdated).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginTop: '12px',
            borderTop: `1px solid ${borderColor}`,
            paddingTop: '10px',
          }}
        >
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              flex: 1,
              padding: '6px 10px',
              backgroundColor: 'rgba(100, 200, 255, 0.1)',
              border: `1px solid ${borderColor}`,
              borderRadius: '4px',
              color: textColor,
              fontFamily: 'inherit',
              fontSize: '11px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            Refresh
          </button>
          <button
            onClick={onClear}
            style={{
              flex: 1,
              padding: '6px 10px',
              backgroundColor: 'rgba(255, 100, 100, 0.1)',
              border: '1px solid rgba(255, 100, 100, 0.3)',
              borderRadius: '4px',
              color: '#ff9999',
              fontFamily: 'inherit',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>

        {/* Color legend */}
        <div
          style={{
            marginTop: '12px',
            borderTop: `1px solid ${borderColor}`,
            paddingTop: '10px',
          }}
        >
          <div
            style={{
              color: dimTextColor,
              marginBottom: '6px',
              fontSize: '10px',
            }}
          >
            Density Legend
          </div>
          <div
            style={{
              height: '12px',
              borderRadius: '3px',
              background:
                'linear-gradient(to right, rgba(0, 100, 255, 0.3), rgba(0, 255, 255, 0.6), rgba(255, 255, 0, 0.7), rgba(255, 100, 0, 0.8))',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '9px',
              color: dimTextColor,
              marginTop: '2px',
            }}
          >
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </>
  );
});

export default HeatMapLayer;
