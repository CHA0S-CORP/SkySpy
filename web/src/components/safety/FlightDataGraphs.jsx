import React, { useCallback, useRef, useState } from 'react';
import { Activity, Plane } from 'lucide-react';

/**
 * Flight Data Graphs Component
 * Displays telemetry graphs for involved aircraft
 */
export function FlightDataGraphs({
  event,
  trackData,
  replayPosition,
  onPositionChange,
  graphsRef
}) {
  const [graphZoomState, setGraphZoomState] = useState({ zoom: 1, offset: 0 });
  const graphDragRef = useRef({ isDragging: false, startX: 0, startPosition: 0 });

  // Graph handlers
  const handleGraphWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setGraphZoomState(prev => {
      const newZoom = Math.max(1, Math.min(8, prev.zoom + delta));
      let newOffset = prev.offset;
      if (newZoom < prev.zoom) {
        const maxOffset = Math.max(0, 100 - (100 / newZoom));
        newOffset = Math.min(prev.offset, maxOffset);
      }
      return { zoom: newZoom, offset: newOffset };
    });
  }, []);

  const handleGraphDragStart = useCallback((e) => {
    e.preventDefault();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    graphDragRef.current = {
      isDragging: true,
      startX: clientX,
      startPosition: replayPosition
    };
  }, [replayPosition]);

  const handleGraphDragMove = useCallback((e) => {
    const drag = graphDragRef.current;
    if (!drag?.isDragging) return;
    e.preventDefault();
    const currentX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const deltaX = currentX - drag.startX;
    const graphWidth = e.currentTarget?.getBoundingClientRect?.()?.width || 300;
    const percentDelta = (deltaX / graphWidth) * 100;
    const newPosition = Math.max(0, Math.min(100, drag.startPosition + percentDelta));
    onPositionChange?.(newPosition);
  }, [onPositionChange]);

  const handleGraphDragEnd = useCallback(() => {
    graphDragRef.current.isDragging = false;
  }, []);

  const resetGraphZoom = useCallback(() => {
    setGraphZoomState({ zoom: 1, offset: 0 });
  }, []);

  // Render mini graph
  const renderMiniGraph = useCallback((track, dataKey, color, label, unit, formatFn, positionPercent = null) => {
    if (!track || track.length < 2) return null;

    const ordered = [...track].reverse();
    const values = ordered.map(p => p[dataKey]).filter(v => v != null);
    if (values.length < 2) return null;

    const format = formatFn || (v => v?.toLocaleString());
    const width = 300;
    const height = 60;
    const padding = 2;

    const { zoom, offset } = graphZoomState;
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

    const points = visibleValues.map((v, i) => {
      const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - fullMin) / fullRange) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    let currentValue = null;
    if (positionPercent !== null && values.length > 0) {
      const idx = Math.floor((positionPercent / 100) * (values.length - 1));
      currentValue = values[Math.max(0, Math.min(idx, values.length - 1))];
    }

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

    return (
      <div
        className={`mini-graph large${isZoomed ? ' zoomable' : ''}`}
        onWheel={handleGraphWheel}
        onMouseDown={handleGraphDragStart}
        onMouseMove={handleGraphDragMove}
        onMouseUp={handleGraphDragEnd}
        onMouseLeave={handleGraphDragEnd}
        onTouchStart={handleGraphDragStart}
        onTouchMove={handleGraphDragMove}
        onTouchEnd={handleGraphDragEnd}
        style={{ touchAction: 'none', cursor: 'grab' }}
      >
        <div className="mini-graph-header">
          <span className="mini-graph-label">{label}</span>
          {isZoomed && (
            <span className="mini-graph-zoom" onClick={resetGraphZoom}>
              {zoom.toFixed(1)}x
            </span>
          )}
          {currentValue !== null && (
            <span className="mini-graph-current" style={{ color }}>
              {format(currentValue)} {unit}
            </span>
          )}
        </div>
        <svg
          width={width}
          height={height}
          className="mini-graph-svg"
          style={{ pointerEvents: 'none' }}
        >
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            opacity="0.7"
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
                  r="5"
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
  }, [graphZoomState, handleGraphWheel, handleGraphDragStart, handleGraphDragMove, handleGraphDragEnd, resetGraphZoom]);

  return (
    <div className="sep-graphs-section" ref={graphsRef}>
      <div className="sep-section-header">
        <Activity size={16} />
        <span>Flight Data</span>
        {graphZoomState.zoom > 1 && (
          <button className="sep-reset-zoom" onClick={resetGraphZoom}>
            Reset Zoom ({graphZoomState.zoom.toFixed(1)}x)
          </button>
        )}
      </div>

      <div className="sep-graphs-container">
        {[event.icao, event.icao_2].filter(Boolean).map((icao, idx) => {
          const track = trackData[icao];
          const color = idx === 0 ? '#00ff88' : '#00d4ff';
          const position = replayPosition;
          const callsign = event[idx === 0 ? 'callsign' : 'callsign_2'] || icao;

          if (!track || track.length < 2) {
            return (
              <div key={icao} className="sep-graphs-aircraft">
                <div className="sep-graphs-label" style={{ color }}>{callsign}</div>
                <div className="sep-no-data">No telemetry data available</div>
              </div>
            );
          }

          return (
            <div key={icao} className="sep-graphs-aircraft">
              <div className="sep-graphs-label" style={{ color }}>
                <Plane size={14} />
                {callsign}
              </div>
              <div className="sep-graphs-row">
                {renderMiniGraph(track, 'altitude', color, 'Altitude', 'ft', null, position)}
                {renderMiniGraph(track, 'gs', color, 'Speed', 'kts', v => v?.toFixed(0), position)}
                {renderMiniGraph(track, 'vr', color, 'Vertical Rate', 'fpm', v => (v > 0 ? '+' : '') + v, position)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FlightDataGraphs;
