import React, { useState, useRef, useCallback, useMemo } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

/**
 * Enhanced mini graph component with zoom/pan, position indicator, and value display
 * @param {Object} props
 * @param {Array} props.data - Array of data points
 * @param {string} props.dataKey - Key to extract value from data points
 * @param {string} props.color - Line color
 * @param {string} props.label - Graph label
 * @param {string} props.unit - Value unit (e.g., 'ft', 'kts')
 * @param {Function} props.formatValue - Custom value formatter
 * @param {number} props.positionPercent - Current position indicator (0-100)
 * @param {string} props.size - Size variant: 'compact' | 'default' | 'large'
 * @param {boolean} props.showControls - Whether to show zoom controls
 * @param {Function} props.onPositionClick - Callback when clicking on graph to set position
 */
export function EnhancedMiniGraph({
  data,
  dataKey,
  color = '#00d4ff',
  label,
  unit = '',
  formatValue,
  positionPercent = null,
  size = 'default',
  showControls = true,
  onPositionClick,
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, offset: 0 });
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const containerRef = useRef(null);

  // Size configurations
  const sizeConfig = {
    compact: { width: 150, height: 30, padding: 2 },
    default: { width: 200, height: 40, padding: 2 },
    large: { width: 300, height: 60, padding: 4 },
  };

  const { width, height, padding } = sizeConfig[size] || sizeConfig.default;

  // Extract and validate values
  const values = useMemo(() => {
    if (!data || data.length < 2) return [];
    return data.map(p => p[dataKey]).filter(v => v != null);
  }, [data, dataKey]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (values.length === 0) return { min: 0, max: 0, range: 1 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, range: max - min || 1 };
  }, [values]);

  // Calculate visible window
  const visibleWindow = useMemo(() => {
    const visiblePercent = 100 / zoom;
    const start = offset;
    const end = Math.min(100, offset + visiblePercent);
    const startIdx = Math.floor((start / 100) * (values.length - 1));
    const endIdx = Math.ceil((end / 100) * (values.length - 1));
    return { start, end, startIdx, endIdx };
  }, [zoom, offset, values.length]);

  // Get visible values
  const visibleValues = useMemo(() => {
    if (values.length === 0) return [];
    return values.slice(visibleWindow.startIdx, visibleWindow.endIdx + 1);
  }, [values, visibleWindow]);

  // Format value
  const format = formatValue || ((v) => v?.toLocaleString());

  // Get current value at position
  const currentValue = useMemo(() => {
    if (positionPercent === null || values.length === 0) return null;
    const idx = Math.floor((positionPercent / 100) * (values.length - 1));
    return values[Math.max(0, Math.min(idx, values.length - 1))];
  }, [positionPercent, values]);

  // Get hovered value
  const hoveredValue = useMemo(() => {
    if (hoveredIndex === null || visibleValues.length === 0) return null;
    return visibleValues[hoveredIndex];
  }, [hoveredIndex, visibleValues]);

  // Create SVG path
  const pathData = useMemo(() => {
    if (visibleValues.length < 2) return '';

    const points = visibleValues.map((v, i) => {
      const x = padding + (i / Math.max(1, visibleValues.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - stats.min) / stats.range) * (height - padding * 2);
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  }, [visibleValues, width, height, padding, stats]);

  // Calculate position indicator location
  const indicatorX = useMemo(() => {
    if (positionPercent === null) return null;
    if (positionPercent < visibleWindow.start || positionPercent > visibleWindow.end) return null;
    const relativePos = (positionPercent - visibleWindow.start) / (100 / zoom);
    return padding + relativePos * (width - padding * 2);
  }, [positionPercent, visibleWindow, zoom, width, padding]);

  const indicatorY = useMemo(() => {
    if (currentValue === null || indicatorX === null) return null;
    return height - padding - ((currentValue - stats.min) / stats.range) * (height - padding * 2);
  }, [currentValue, indicatorX, height, padding, stats]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(8, z + 0.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => {
      const newZoom = Math.max(1, z - 0.5);
      // Adjust offset when zooming out
      const maxOffset = Math.max(0, 100 - (100 / newZoom));
      setOffset(o => Math.min(o, maxOffset));
      return newZoom;
    });
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setOffset(0);
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoom(z => {
      const newZoom = Math.max(1, Math.min(8, z + delta));
      if (newZoom < z) {
        const maxOffset = Math.max(0, 100 - (100 / newZoom));
        setOffset(o => Math.min(o, maxOffset));
      }
      return newZoom;
    });
  }, []);

  // Pan handlers
  const handleDragStart = useCallback((e) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX || e.touches?.[0]?.clientX || 0,
      offset,
    });
  }, [zoom, offset]);

  const handleDragMove = useCallback((e) => {
    if (!isDragging) return;
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const deltaX = dragStart.x - currentX;
    const visiblePercent = 100 / zoom;
    const maxOffset = 100 - visiblePercent;
    const percentDelta = (deltaX / width) * visiblePercent;
    setOffset(Math.max(0, Math.min(maxOffset, dragStart.offset + percentDelta)));
  }, [isDragging, dragStart, zoom, width]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse hover for value tooltip
  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current || isDragging) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - padding;
    const graphWidth = width - padding * 2;
    const index = Math.round((x / graphWidth) * (visibleValues.length - 1));
    if (index >= 0 && index < visibleValues.length) {
      setHoveredIndex(index);
    }
  }, [isDragging, padding, width, visibleValues.length]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  // Click to set position
  const handleClick = useCallback((e) => {
    if (!onPositionClick || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - padding;
    const graphWidth = width - padding * 2;
    const relativePos = Math.max(0, Math.min(1, x / graphWidth));
    const absolutePos = visibleWindow.start + relativePos * (100 / zoom);
    onPositionClick(Math.max(0, Math.min(100, absolutePos)));
  }, [onPositionClick, padding, width, visibleWindow, zoom]);

  if (values.length < 2) return null;

  const isZoomed = zoom > 1;
  const displayValue = hoveredValue !== null ? hoveredValue : currentValue;

  return (
    <div className={`enhanced-mini-graph size-${size}`}>
      <div className="mini-graph-header">
        <span className="mini-graph-label">{label}</span>
        {showControls && isZoomed && (
          <span className="mini-graph-zoom" onClick={handleReset}>
            {zoom.toFixed(1)}x
          </span>
        )}
        {displayValue !== null && (
          <span className="mini-graph-current" style={{ color }}>
            {format(displayValue)} {unit}
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className={`mini-graph-svg-container ${isZoomed ? 'zoomable' : ''} ${isDragging ? 'dragging' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleDragStart}
        onMouseMove={(e) => { handleDragMove(e); handleMouseMove(e); }}
        onMouseUp={handleDragEnd}
        onMouseLeave={() => { handleDragEnd(); handleMouseLeave(); }}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
        onClick={handleClick}
      >
        <svg width={width} height={height} className="mini-graph-svg">
          {/* Grid lines (optional for large size) */}
          {size === 'large' && (
            <>
              <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
              <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
              <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
            </>
          )}

          {/* Data line */}
          <path
            d={pathData}
            fill="none"
            stroke={color}
            strokeWidth={size === 'large' ? 2 : 1.5}
            opacity="0.7"
          />

          {/* Area fill */}
          {size === 'large' && pathData && (
            <path
              d={`${pathData} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`}
              fill={color}
              opacity="0.1"
            />
          )}

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
                opacity="0.9"
              />
              {indicatorY !== null && (
                <circle
                  cx={indicatorX}
                  cy={indicatorY}
                  r={size === 'large' ? 5 : 4}
                  fill={color}
                  stroke="#000"
                  strokeWidth="1"
                />
              )}
            </>
          )}

          {/* Hover indicator */}
          {hoveredIndex !== null && visibleValues[hoveredIndex] !== undefined && (
            <circle
              cx={padding + (hoveredIndex / Math.max(1, visibleValues.length - 1)) * (width - padding * 2)}
              cy={height - padding - ((visibleValues[hoveredIndex] - stats.min) / stats.range) * (height - padding * 2)}
              r={3}
              fill="#fff"
              stroke={color}
              strokeWidth="1"
            />
          )}
        </svg>
      </div>

      <div className="mini-graph-range">
        <span>{format(isZoomed ? Math.min(...visibleValues) : stats.min)} {unit}</span>
        <span>{format(isZoomed ? Math.max(...visibleValues) : stats.max)} {unit}</span>
      </div>

      {showControls && size === 'large' && (
        <div className="mini-graph-controls">
          <button onClick={handleZoomOut} disabled={zoom <= 1} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button onClick={handleZoomIn} disabled={zoom >= 8} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button onClick={handleReset} disabled={zoom === 1} title="Reset zoom">
            <RotateCcw size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default EnhancedMiniGraph;
