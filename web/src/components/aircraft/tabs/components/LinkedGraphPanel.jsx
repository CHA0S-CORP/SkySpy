import { useMemo, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';

/**
 * LinkedGraphPanel - 6 synchronized graphs with shared cursor and brush zoom
 */
export function LinkedGraphPanel({
  sightings = [],
  selectedIndex = null,
  onSelectIndex,
  safetyEvents = [],
  graphZoom = { start: 0, end: 1 },
  onGraphZoom,
  height = 150,
  className = '',
}) {
  const containerRef = useRef(null);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);

  // Graph configurations
  const graphConfigs = useMemo(
    () => [
      {
        key: 'altitude',
        label: 'Altitude',
        unit: 'ft',
        color: '#3b82f6',
        field: 'altitude',
        formatter: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v),
      },
      {
        key: 'speed',
        label: 'Speed',
        unit: 'kts',
        color: '#22c55e',
        field: 'gs',
        formatter: (v) => Math.round(v),
      },
      {
        key: 'vs',
        label: 'V/S',
        unit: 'fpm',
        color: '#f59e0b',
        field: 'vr',
        formatter: (v) => (v > 0 ? `+${v}` : v),
        baseline: true,
      },
      {
        key: 'distance',
        label: 'Distance',
        unit: 'nm',
        color: '#8b5cf6',
        field: 'distance_nm',
        formatter: (v) => v.toFixed(1),
      },
      {
        key: 'rssi',
        label: 'Signal',
        unit: 'dB',
        color: '#ef4444',
        field: 'rssi',
        formatter: (v) => v.toFixed(1),
      },
      {
        key: 'track',
        label: 'Track',
        unit: '°',
        color: '#06b6d4',
        field: 'track',
        formatter: (v) => Math.round(v),
        circular: true,
      },
    ],
    []
  );

  // Process data for each graph
  const graphData = useMemo(() => {
    if (!sightings.length) return {};

    // Apply zoom
    const totalPoints = sightings.length;
    const startIdx = Math.floor(graphZoom.start * totalPoints);
    const endIdx = Math.ceil(graphZoom.end * totalPoints);
    const zoomedSightings = sightings.slice(startIdx, endIdx);

    const data = {};
    graphConfigs.forEach((config) => {
      const values = zoomedSightings.map((s) => s[config.field] ?? null);
      const validValues = values.filter((v) => v !== null && v !== undefined);

      let min = Math.min(...validValues);
      let max = Math.max(...validValues);

      // Add padding
      const range = max - min || 1;
      min -= range * 0.1;
      max += range * 0.1;

      // Special handling for V/S (should include 0)
      if (config.baseline) {
        min = Math.min(min, -100);
        max = Math.max(max, 100);
      }

      // Special handling for circular data (track)
      if (config.circular) {
        min = 0;
        max = 360;
      }

      data[config.key] = {
        values,
        min,
        max,
        startIdx,
      };
    });

    return data;
  }, [sightings, graphZoom, graphConfigs]);

  // Safety event markers
  const eventMarkers = useMemo(() => {
    if (!safetyEvents.length || !sightings.length) return [];

    return safetyEvents.map((event) => {
      // Find closest sighting to event timestamp
      const eventTime = new Date(event.timestamp).getTime();
      let closestIdx = 0;
      let closestDiff = Infinity;

      sightings.forEach((s, i) => {
        const sTime = new Date(s.timestamp).getTime();
        const diff = Math.abs(sTime - eventTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIdx = i;
        }
      });

      return {
        index: closestIdx,
        event,
        color:
          event.severity === 'critical'
            ? '#ef4444'
            : event.severity === 'warning'
              ? '#f59e0b'
              : '#3b82f6',
      };
    });
  }, [safetyEvents, sightings]);

  // Handle mouse interactions
  const getIndexFromEvent = useCallback(
    (e, graphElement) => {
      if (!graphElement || !sightings.length) return null;
      const rect = graphElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      const totalPoints = graphData[graphConfigs[0].key]?.values?.length || 0;
      const idx = Math.round(percent * (totalPoints - 1));
      const startIdx = graphData[graphConfigs[0].key]?.startIdx || 0;
      return Math.max(0, Math.min(sightings.length - 1, startIdx + idx));
    },
    [sightings, graphData, graphConfigs]
  );

  const handleMouseMove = useCallback(
    (e) => {
      const graphEl = e.currentTarget;
      const idx = getIndexFromEvent(e, graphEl);
      if (idx !== null) {
        setHoveredIndex(idx);
      }

      // Handle brush selection (visual update, actual zoom on mouse up)
    },
    [getIndexFromEvent, isDragging, dragStart]
  );

  const handleMouseDown = useCallback((e) => {
    const graphEl = e.currentTarget;
    const rect = graphEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    setIsDragging(true);
    setDragStart(percent);
  }, []);

  const handleMouseUp = useCallback(
    (e) => {
      if (isDragging && dragStart !== null) {
        const graphEl = e.currentTarget;
        const rect = graphEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const endPercent = Math.max(0, Math.min(1, x / rect.width));

        // Only apply zoom if drag was significant
        if (Math.abs(endPercent - dragStart) > 0.05) {
          const start = Math.min(dragStart, endPercent);
          const end = Math.max(dragStart, endPercent);
          onGraphZoom?.({
            start: graphZoom.start + start * (graphZoom.end - graphZoom.start),
            end: graphZoom.start + end * (graphZoom.end - graphZoom.start),
          });
        }
      }
      setIsDragging(false);
      setDragStart(null);
    },
    [isDragging, dragStart, graphZoom, onGraphZoom]
  );

  const handleClick = useCallback(
    (e) => {
      const graphEl = e.currentTarget;
      const idx = getIndexFromEvent(e, graphEl);
      if (idx !== null) {
        onSelectIndex?.(idx);
      }
    },
    [getIndexFromEvent, onSelectIndex]
  );

  const handleDoubleClick = useCallback(() => {
    // Reset zoom
    onGraphZoom?.({ start: 0, end: 1 });
  }, [onGraphZoom]);

  // Render a single graph
  const renderGraph = (config) => {
    const data = graphData[config.key];
    if (!data || !data.values.length) {
      return (
        <div className="linked-graphs-panel__graph" key={config.key}>
          <span className="linked-graphs-panel__graph-label">{config.label}</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-dim)',
              fontSize: '11px',
            }}
          >
            No data
          </div>
        </div>
      );
    }

    const { values, min, max } = data;
    const range = max - min || 1;
    const width = 100;
    const graphHeight = height - 30;

    // Generate path
    const points = values
      .map((v, i) => {
        if (v === null || v === undefined) return null;
        const x = (i / (values.length - 1)) * width;
        const y = graphHeight - ((v - min) / range) * graphHeight;
        return { x, y, value: v };
      })
      .filter(Boolean);

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    // Cursor position
    const cursorIdx = hoveredIndex !== null ? hoveredIndex - data.startIdx : null;
    const cursorVisible = cursorIdx !== null && cursorIdx >= 0 && cursorIdx < values.length;
    const cursorX = cursorVisible ? (cursorIdx / (values.length - 1)) * 100 : 0;
    const cursorValue = cursorVisible ? values[cursorIdx] : null;

    // Selected position
    const selectedIdx = selectedIndex !== null ? selectedIndex - data.startIdx : null;
    const selectedVisible = selectedIdx !== null && selectedIdx >= 0 && selectedIdx < values.length;
    const selectedX = selectedVisible ? (selectedIdx / (values.length - 1)) * 100 : 0;

    return (
      <div
        className="linked-graphs-panel__graph"
        key={config.key}
        role="button"
        aria-label={`${config.label} graph - interactive chart`}
        tabIndex={0}
        style={{ height }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setHoveredIndex(null)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleDoubleClick();
        }}
      >
        <span className="linked-graphs-panel__graph-label">{config.label}</span>

        <svg
          width="100%"
          height={graphHeight}
          viewBox={`0 0 ${width} ${graphHeight}`}
          preserveAspectRatio="none"
        >
          {/* Baseline for V/S */}
          {config.baseline && (
            <line
              x1="0"
              y1={graphHeight - ((0 - min) / range) * graphHeight}
              x2={width}
              y2={graphHeight - ((0 - min) / range) * graphHeight}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          )}

          {/* Area fill */}
          <path
            d={`${pathD} L ${width} ${graphHeight} L 0 ${graphHeight} Z`}
            fill={config.color}
            fillOpacity="0.1"
          />

          {/* Line */}
          <path
            d={pathD}
            fill="none"
            stroke={config.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Safety event markers */}
          {eventMarkers.map((marker) => {
            const markerIdx = marker.index - data.startIdx;
            if (markerIdx < 0 || markerIdx >= values.length) return null;
            const markerX = (markerIdx / (values.length - 1)) * width;
            return (
              <line
                key={marker.event?.id || `marker-${markerX}-${markerIdx}`}
                x1={markerX}
                y1="0"
                x2={markerX}
                y2={graphHeight}
                stroke={marker.color}
                strokeWidth="2"
                strokeDasharray="3,2"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* Selected position marker */}
          {selectedVisible && (
            <line
              x1={selectedX}
              y1="0"
              x2={selectedX}
              y2={graphHeight}
              stroke="var(--accent-green)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Cursor line and tooltip */}
        {cursorVisible && (
          <>
            <div className="linked-graphs-panel__cursor-line" style={{ left: `${cursorX}%` }} />
            <div className="linked-graphs-panel__cursor-tooltip" style={{ left: `${cursorX}%` }}>
              {config.formatter(cursorValue)} {config.unit}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`linked-graphs-panel ${className}`}>
      {graphConfigs.map(renderGraph)}
    </div>
  );
}

LinkedGraphPanel.propTypes = {
  sightings: PropTypes.array,
  selectedIndex: PropTypes.number,
  onSelectIndex: PropTypes.func,
  safetyEvents: PropTypes.array,
  graphZoom: PropTypes.shape({
    start: PropTypes.number,
    end: PropTypes.number,
  }),
  onGraphZoom: PropTypes.func,
  height: PropTypes.number,
  className: PropTypes.string,
};

export default LinkedGraphPanel;
