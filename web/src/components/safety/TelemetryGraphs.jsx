import React, { useCallback, useRef, useState } from 'react';
import { Plane } from 'lucide-react';

/**
 * Enhanced Telemetry Graphs Component
 *
 * Features:
 * - Gradient area fill under line
 * - Current value prominently displayed
 * - Min/max range labels
 * - Larger position indicator dot
 * - Zoom/pan support with mouse wheel and drag
 * - Responsive width
 */
export function TelemetryGraphs({
  trackData,
  aircraftInfo,
  position = 100,
  onPositionChange,
  className = ''
}) {
  const [zoomState, setZoomState] = useState({ zoom: 1, offset: 0 });
  const dragRef = useRef({ isDragging: false, startX: 0, startPosition: 0 });

  // Handle zoom with wheel
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoomState((prev) => {
      const newZoom = Math.max(1, Math.min(8, prev.zoom + delta));
      let newOffset = prev.offset;
      if (newZoom < prev.zoom) {
        const maxOffset = Math.max(0, 100 - 100 / newZoom);
        newOffset = Math.min(prev.offset, maxOffset);
      }
      return { zoom: newZoom, offset: newOffset };
    });
  }, []);

  // Handle drag for scrubbing timeline
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    dragRef.current = {
      isDragging: true,
      startX: clientX,
      startPosition: position
    };
  }, [position]);

  const handleDragMove = useCallback((e) => {
    if (!dragRef.current?.isDragging) return;
    e.preventDefault();
    const currentX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const deltaX = currentX - dragRef.current.startX;
    const graphWidth = e.currentTarget?.getBoundingClientRect?.()?.width || 300;
    const percentDelta = (deltaX / graphWidth) * 100;
    const newPosition = Math.max(0, Math.min(100, dragRef.current.startPosition + percentDelta));
    onPositionChange?.(newPosition);
  }, [onPositionChange]);

  const handleDragEnd = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);

  const resetZoom = useCallback(() => {
    setZoomState({ zoom: 1, offset: 0 });
  }, []);

  return (
    <div className={`telemetry-graphs-v2 ${className}`}>
      {aircraftInfo.map((aircraft, idx) => {
        const track = trackData[aircraft.icao];
        const color = idx === 0 ? '#00ff88' : '#00d4ff';

        if (!track || track.length < 2) {
          return (
            <div key={aircraft.icao} className="tg-aircraft">
              <div className="tg-aircraft-header" style={{ color }}>
                <Plane size={14} />
                <span>{aircraft.callsign || aircraft.icao}</span>
              </div>
              <div className="tg-no-data">No telemetry data available</div>
            </div>
          );
        }

        return (
          <div key={aircraft.icao} className="tg-aircraft">
            <div className="tg-aircraft-header" style={{ color }}>
              <Plane size={14} />
              <span>{aircraft.callsign || aircraft.icao}</span>
              {zoomState.zoom > 1 && (
                <button className="tg-reset-zoom" onClick={resetZoom}>
                  Reset {zoomState.zoom.toFixed(1)}x
                </button>
              )}
            </div>
            <div className="tg-graphs-row">
              <TelemetryGraph
                track={track}
                dataKey="altitude"
                color={color}
                label="Altitude"
                unit="ft"
                position={position}
                zoomState={zoomState}
                onWheel={handleWheel}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
              <TelemetryGraph
                track={track}
                dataKey="gs"
                color={color}
                label="Speed"
                unit="kts"
                formatFn={(v) => v?.toFixed(0)}
                position={position}
                zoomState={zoomState}
                onWheel={handleWheel}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
              <TelemetryGraph
                track={track}
                dataKey="vr"
                color={color}
                label="V/S"
                unit="fpm"
                formatFn={(v) => (v > 0 ? '+' : '') + v}
                position={position}
                zoomState={zoomState}
                onWheel={handleWheel}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Individual Telemetry Graph with gradient fill
 */
function TelemetryGraph({
  track,
  dataKey,
  color,
  label,
  unit,
  formatFn,
  position,
  zoomState,
  onWheel,
  onDragStart,
  onDragMove,
  onDragEnd
}) {
  const format = formatFn || ((v) => v?.toLocaleString());
  const width = 280;
  const height = 70;
  const padding = 4;

  // Reverse track for timeline order (oldest first)
  const ordered = [...track].reverse();
  const values = ordered.map((p) => p[dataKey]).filter((v) => v != null);

  if (values.length < 2) return null;

  const { zoom, offset } = zoomState;
  const isZoomed = zoom > 1;

  const fullMin = Math.min(...values);
  const fullMax = Math.max(...values);
  const fullRange = fullMax - fullMin || 1;

  let visibleValues, visibleMin, visibleMax, startPercent, endPercent;

  if (isZoomed) {
    const visiblePercent = 100 / zoom;
    startPercent = offset;
    endPercent = offset + visiblePercent;
    const startIdx = Math.floor((startPercent / 100) * (values.length - 1));
    const endIdx = Math.ceil((endPercent / 100) * (values.length - 1));
    visibleValues = values.slice(startIdx, endIdx + 1);
    visibleMin = visibleValues.length > 0 ? Math.min(...visibleValues) : fullMin;
    visibleMax = visibleValues.length > 0 ? Math.max(...visibleValues) : fullMax;
  } else {
    startPercent = 0;
    endPercent = 100;
    visibleValues = values;
    visibleMin = fullMin;
    visibleMax = fullMax;
  }

  // Build path points
  const linePoints = visibleValues
    .map((v, i) => {
      const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - fullMin) / fullRange) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  // Build area path for gradient fill
  const areaPath = visibleValues
    .map((v, i) => {
      const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - fullMin) / fullRange) * (height - padding * 2);
      return i === 0 ? `M ${x},${y}` : `L ${x},${y}`;
    })
    .join(' ');

  const areaPathClosed =
    areaPath +
    ` L ${padding + (width - padding * 2)},${height - padding} L ${padding},${height - padding} Z`;

  // Get current value at position
  let currentValue = null;
  if (position !== null && values.length > 0) {
    const idx = Math.floor((position / 100) * (values.length - 1));
    currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
  }

  // Calculate indicator position
  let indicatorX = null;
  let indicatorY = null;
  const positionInWindow = position !== null && position >= startPercent && position <= endPercent;
  if (positionInWindow) {
    const visiblePercent = 100 / zoom;
    const relativePosition = (position - startPercent) / visiblePercent;
    indicatorX = padding + relativePosition * (width - padding * 2);
    if (currentValue !== null) {
      indicatorY = height - padding - ((currentValue - fullMin) / fullRange) * (height - padding * 2);
    }
  }

  const gradientId = `gradient-${label}-${color.replace('#', '')}`;

  return (
    <div
      className="tg-graph-card"
      onWheel={onWheel}
      onMouseDown={onDragStart}
      onMouseMove={onDragMove}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
      onTouchStart={onDragStart}
      onTouchMove={onDragMove}
      onTouchEnd={onDragEnd}
      style={{ touchAction: 'none', cursor: 'grab' }}
    >
      <div className="tg-graph-header">
        <span className="tg-graph-label">{label}</span>
        {currentValue !== null && (
          <span className="tg-graph-value" style={{ color }}>
            {format(currentValue)} {unit}
          </span>
        )}
      </div>

      <svg
        width={width}
        height={height}
        className="tg-graph-svg"
        style={{ pointerEvents: 'none' }}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Area fill with gradient */}
        <path d={areaPathClosed} fill={`url(#${gradientId})`} />

        {/* Line */}
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" opacity="0.9" />

        {/* Position indicator */}
        {indicatorX !== null && (
          <>
            <line
              x1={indicatorX}
              y1={0}
              x2={indicatorX}
              y2={height}
              stroke={color}
              strokeWidth="2"
              opacity="0.8"
            />
            {indicatorY !== null && (
              <circle
                cx={indicatorX}
                cy={indicatorY}
                r="6"
                fill={color}
                stroke="#000"
                strokeWidth="1.5"
              />
            )}
          </>
        )}
      </svg>

      <div className="tg-graph-range">
        <span>{format(isZoomed ? visibleMin : fullMin)}</span>
        <span>{format(isZoomed ? visibleMax : fullMax)}</span>
      </div>
    </div>
  );
}

export default TelemetryGraphs;
