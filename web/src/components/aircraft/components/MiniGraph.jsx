import React, { useCallback, useRef } from 'react';

export function MiniGraph({
  data,
  dataKey,
  color,
  label,
  unit,
  formatFn,
  positionPercent = null,
  graphZoom = 1,
  graphScrollOffset = 0,
  onWheel,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResetZoom,
  width = 200,
  height = 40
}) {
  if (!data || data.length < 2) return null;

  const ordered = [...data].reverse();
  const values = ordered.map(p => p[dataKey]).filter(v => v != null);
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 2;

  const isZoomed = graphZoom > 1;
  let visiblePoints, visibleMin, visibleMax, startPercent, endPercent, visiblePercent;

  if (isZoomed) {
    visiblePercent = 100 / graphZoom;
    startPercent = graphScrollOffset;
    endPercent = startPercent + visiblePercent;

    visiblePoints = values.map((v, i) => {
      const dataPercent = (i / (values.length - 1)) * 100;
      if (dataPercent < startPercent || dataPercent > endPercent) return null;
      const normalizedPercent = (dataPercent - startPercent) / visiblePercent;
      const x = padding + normalizedPercent * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return { x, y, value: v, dataPercent };
    }).filter(Boolean);

    const visibleVals = visiblePoints.map(p => p.value);
    visibleMin = visibleVals.length > 0 ? Math.min(...visibleVals) : min;
    visibleMax = visibleVals.length > 0 ? Math.max(...visibleVals) : max;
  } else {
    startPercent = 0;
    endPercent = 100;
    visiblePercent = 100;
    visiblePoints = values.map((v, i) => {
      const x = padding + (i / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return { x, y, value: v, dataPercent: (i / (values.length - 1)) * 100 };
    });
    visibleMin = min;
    visibleMax = max;
  }

  const points = visiblePoints.map(p => `${p.x},${p.y}`).join(' ');
  const format = formatFn || (v => v?.toLocaleString());

  let indicatorX = null;
  let indicatorY = null;
  let currentValue = null;
  if (positionPercent !== null) {
    if (positionPercent >= startPercent && positionPercent <= endPercent) {
      const normalizedPercent = (positionPercent - startPercent) / visiblePercent;
      indicatorX = padding + normalizedPercent * (width - padding * 2);
      const idx = Math.floor((positionPercent / 100) * (values.length - 1));
      currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
      indicatorY = height - padding - ((currentValue - min) / range) * (height - padding * 2);
    } else {
      const idx = Math.floor((positionPercent / 100) * (values.length - 1));
      currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
    }
  }

  return (
    <div
      className={`mini-graph ${graphZoom > 1 ? 'zoomable' : ''}`}
      onWheel={onWheel}
      onMouseDown={onDragStart}
      onMouseMove={onDragMove}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
      onTouchStart={onDragStart}
      onTouchMove={onDragMove}
      onTouchEnd={onDragEnd}
      role="img"
      aria-label={`${label} graph showing values from ${format(visibleMin)} to ${format(visibleMax)} ${unit}`}
    >
      <div className="mini-graph-header">
        <span className="mini-graph-label">{label}</span>
        {graphZoom > 1 && (
          <button
            className="mini-graph-zoom"
            onClick={onResetZoom}
            title="Reset zoom"
            aria-label="Reset graph zoom"
          >
            {graphZoom.toFixed(1)}x
          </button>
        )}
        {currentValue !== null && (
          <span className="mini-graph-current" style={{ color }} aria-live="polite">
            {format(currentValue)} {unit}
          </span>
        )}
      </div>
      <svg
        width={width}
        height={height}
        className="mini-graph-svg"
        aria-hidden="true"
      >
        {visiblePoints.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            opacity="0.6"
          />
        )}
        {indicatorX !== null && indicatorY !== null && (
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
            <circle
              cx={indicatorX}
              cy={indicatorY}
              r="4"
              fill={color}
              stroke="#000"
              strokeWidth="1"
            />
          </>
        )}
      </svg>
      <div className="mini-graph-range" aria-hidden="true">
        <span>{format(visibleMin)} {unit}</span>
        <span>{format(visibleMax)} {unit}</span>
      </div>
    </div>
  );
}

// Hooks for graph interaction
export function useGraphInteraction(graphZoom, setGraphZoom, graphScrollOffset, setGraphScrollOffset) {
  const graphDragRef = useRef({ isDragging: false, startX: 0, startOffset: 0 });

  const handleGraphWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setGraphZoom(prev => {
      const newZoom = Math.max(1, Math.min(8, prev + delta));
      if (newZoom < prev) {
        const maxOffset = Math.max(0, 100 - (100 / newZoom));
        setGraphScrollOffset(off => Math.min(off, maxOffset));
      }
      return newZoom;
    });
  }, [setGraphZoom, setGraphScrollOffset]);

  const handleGraphDragStart = useCallback((e) => {
    if (graphZoom <= 1) return;
    graphDragRef.current = {
      isDragging: true,
      startX: e.clientX || e.touches?.[0]?.clientX || 0,
      startOffset: graphScrollOffset
    };
  }, [graphZoom, graphScrollOffset]);

  const handleGraphDragMove = useCallback((e) => {
    if (!graphDragRef.current.isDragging) return;
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const deltaX = graphDragRef.current.startX - currentX;
    const graphWidth = 200;
    const visiblePercent = 100 / graphZoom;
    const maxOffset = 100 - visiblePercent;
    const percentDelta = (deltaX / graphWidth) * visiblePercent;
    const newOffset = Math.max(0, Math.min(maxOffset, graphDragRef.current.startOffset + percentDelta));
    setGraphScrollOffset(newOffset);
  }, [graphZoom, setGraphScrollOffset]);

  const handleGraphDragEnd = useCallback(() => {
    graphDragRef.current.isDragging = false;
  }, []);

  const resetGraphZoom = useCallback(() => {
    setGraphZoom(1);
    setGraphScrollOffset(0);
  }, [setGraphZoom, setGraphScrollOffset]);

  return {
    handleGraphWheel,
    handleGraphDragStart,
    handleGraphDragMove,
    handleGraphDragEnd,
    resetGraphZoom
  };
}
