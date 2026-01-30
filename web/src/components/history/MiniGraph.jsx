import React from 'react';

/**
 * Mini graph component for displaying flight data graphs with zoom/scroll support
 */
export function MiniGraph({
  track,
  dataKey,
  color,
  label,
  unit,
  formatFn,
  positionPercent = null,
  eventKey = null,
  graphZoomState = {},
  onWheel,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResetZoom
}) {
  if (!track || track.length < 2) return null;

  // Reverse so oldest is first (left to right timeline)
  const ordered = [...track].reverse();
  const values = ordered.map(p => p[dataKey]).filter(v => v != null);
  if (values.length < 2) return null;

  const format = formatFn || (v => v?.toLocaleString());
  const width = 200;
  const height = 40;
  const padding = 2;

  // Get zoom state for this event
  const zoomState = eventKey ? (graphZoomState[eventKey] || { zoom: 1, offset: 0 }) : { zoom: 1, offset: 0 };
  const { zoom, offset } = zoomState;
  const isZoomed = zoom > 1;

  // Full range for consistent Y scaling
  const fullMin = Math.min(...values);
  const fullMax = Math.max(...values);
  const fullRange = fullMax - fullMin || 1;

  let visibleValues, visibleMin, visibleMax, startPercent, endPercent;

  if (isZoomed) {
    // Calculate visible window based on zoom and offset
    const visiblePercent = 100 / zoom;
    startPercent = offset;
    endPercent = offset + visiblePercent;

    // Get visible portion of data
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

  // Create SVG path
  const points = visibleValues.map((v, i) => {
    const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - fullMin) / fullRange) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  // Get current value at position
  let currentValue = null;
  if (positionPercent !== null && values.length > 0) {
    const idx = Math.floor((positionPercent / 100) * (values.length - 1));
    const clampedIdx = Math.max(0, Math.min(idx, values.length - 1));
    currentValue = values[clampedIdx];
  }

  // Calculate position indicator
  let indicatorX = null;
  let indicatorY = null;
  const positionInWindow = positionPercent !== null && positionPercent >= startPercent && positionPercent <= endPercent;
  if (positionInWindow) {
    const visiblePercent = 100 / zoom;
    const relativePosition = (positionPercent - startPercent) / visiblePercent;
    indicatorX = padding + relativePosition * (width - padding * 2);
    if (currentValue !== null) {
      indicatorY = height - padding - ((currentValue - fullMin) / fullRange) * (height - padding * 2);
    }
  }

  // Graph container props for zoom/scroll
  const graphProps = eventKey ? {
    className: `mini-graph${isZoomed ? ' zoomable' : ''}`,
    onWheel: (e) => onWheel?.(eventKey, e),
    onMouseDown: (e) => onDragStart?.(eventKey, e),
    onMouseMove: (e) => onDragMove?.(eventKey, e),
    onMouseUp: () => onDragEnd?.(eventKey),
    onMouseLeave: () => onDragEnd?.(eventKey),
    onTouchStart: (e) => onDragStart?.(eventKey, e),
    onTouchMove: (e) => onDragMove?.(eventKey, e),
    onTouchEnd: () => onDragEnd?.(eventKey),
  } : { className: 'mini-graph' };

  return (
    <div {...graphProps}>
      <div className="mini-graph-header">
        <span className="mini-graph-label">{label}</span>
        {isZoomed && (
          <span className="mini-graph-zoom" onClick={() => onResetZoom?.(eventKey)}>
            {zoom.toFixed(1)}x
          </span>
        )}
        {currentValue !== null && (
          <span className="mini-graph-current" style={{ color }}>
            {format(currentValue)} {unit}
          </span>
        )}
      </div>
      <svg width={width} height={height} className="mini-graph-svg">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity="0.6"
        />
        {indicatorX !== null && (
          <>
            <line
              x1={indicatorX}
              y1={0}
              x2={indicatorX}
              y2={height}
              stroke={color}
              strokeWidth="2"
              opacity="0.9"
            />
            {indicatorY !== null && (
              <circle
                cx={indicatorX}
                cy={indicatorY}
                r="4"
                fill={color}
                stroke="#000"
                strokeWidth="1"
              />
            )}
          </>
        )}
      </svg>
      <div className="mini-graph-range">
        <span>{format(isZoomed ? visibleMin : fullMin)} {unit}</span>
        <span>{format(isZoomed ? visibleMax : fullMax)} {unit}</span>
      </div>
    </div>
  );
}
