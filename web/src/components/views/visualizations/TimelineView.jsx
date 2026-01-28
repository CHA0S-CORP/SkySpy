import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, AlertTriangle, Plane, MessageCircle, Radio } from 'lucide-react';

// Severity color mapping
const SEVERITY_COLORS = {
  critical: '#ff4757',
  warning: '#ff9f43',
  info: '#00d4ff',
  default: '#5a7a9a',
};

// Event type icons and colors
const EVENT_TYPE_CONFIG = {
  safety: { icon: AlertTriangle, color: '#ff4757', label: 'Safety' },
  session: { icon: Plane, color: '#00d4ff', label: 'Session' },
  acars: { icon: MessageCircle, color: '#00ff88', label: 'ACARS' },
  sighting: { icon: Radio, color: '#a371f7', label: 'Sighting' },
};

/**
 * Timeline View component for chronological display of events
 * @param {Object} props
 * @param {Array} props.events - Array of events with timestamp, type, severity
 * @param {Function} props.onEventClick - Callback when clicking an event
 * @param {string} props.selectedEventId - Currently selected event ID
 * @param {Date} props.startTime - Timeline start time
 * @param {Date} props.endTime - Timeline end time
 */
export function TimelineView({
  events = [],
  onEventClick,
  selectedEventId,
  startTime,
  endTime,
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, offset: 0 });
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const containerRef = useRef(null);
  const svgRef = useRef(null);

  // Calculate time bounds from events if not provided
  const timeBounds = useMemo(() => {
    if (startTime && endTime) {
      return {
        start: new Date(startTime).getTime(),
        end: new Date(endTime).getTime(),
      };
    }

    if (events.length === 0) {
      const now = Date.now();
      return { start: now - 24 * 60 * 60 * 1000, end: now };
    }

    const timestamps = events.map(e => new Date(e.timestamp).getTime());
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    // Add 5% padding on each side
    const padding = (max - min) * 0.05 || 3600000;
    return { start: min - padding, end: max + padding };
  }, [events, startTime, endTime]);

  // Process events and group by severity
  const processedEvents = useMemo(() => {
    return events
      .map(event => ({
        ...event,
        time: new Date(event.timestamp).getTime(),
        type: event.event_type || event.type || 'session',
        severity: event.severity || 'info',
      }))
      .filter(e => e.time >= timeBounds.start && e.time <= timeBounds.end)
      .sort((a, b) => a.time - b.time);
  }, [events, timeBounds]);

  // Calculate visible time window
  const visibleWindow = useMemo(() => {
    const totalDuration = timeBounds.end - timeBounds.start;
    const visibleDuration = totalDuration / zoom;
    const offsetTime = (offset / 100) * totalDuration;
    return {
      start: timeBounds.start + offsetTime,
      end: timeBounds.start + offsetTime + visibleDuration,
      duration: visibleDuration,
    };
  }, [timeBounds, zoom, offset]);

  // Filter events in visible window
  const visibleEvents = useMemo(() => {
    return processedEvents.filter(
      e => e.time >= visibleWindow.start && e.time <= visibleWindow.end
    );
  }, [processedEvents, visibleWindow]);

  // Generate time axis ticks
  const timeTicks = useMemo(() => {
    const ticks = [];
    const duration = visibleWindow.duration;

    // Determine appropriate interval based on duration
    let interval;
    if (duration < 3600000) interval = 300000; // 5 min
    else if (duration < 21600000) interval = 1800000; // 30 min
    else if (duration < 86400000) interval = 3600000; // 1 hour
    else if (duration < 604800000) interval = 21600000; // 6 hours
    else interval = 86400000; // 1 day

    const startTick = Math.ceil(visibleWindow.start / interval) * interval;
    for (let time = startTick; time <= visibleWindow.end; time += interval) {
      ticks.push({
        time,
        position: ((time - visibleWindow.start) / duration) * 100,
        label: formatTickLabel(time, interval),
      });
    }
    return ticks;
  }, [visibleWindow]);

  function formatTickLabel(time, interval) {
    const date = new Date(time);
    if (interval >= 86400000) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (interval >= 3600000) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
  }

  // Event position calculation
  const getEventPosition = useCallback((event) => {
    return ((event.time - visibleWindow.start) / visibleWindow.duration) * 100;
  }, [visibleWindow]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(10, z + 0.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => {
      const newZoom = Math.max(1, z - 0.5);
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
      const newZoom = Math.max(1, Math.min(10, z + delta));
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
    if (!isDragging || !containerRef.current) return;
    const currentX = e.clientX || e.touches?.[0]?.clientX || 0;
    const containerWidth = containerRef.current.offsetWidth;
    const deltaX = dragStart.x - currentX;
    const visiblePercent = 100 / zoom;
    const maxOffset = 100 - visiblePercent;
    const percentDelta = (deltaX / containerWidth) * visiblePercent;
    setOffset(Math.max(0, Math.min(maxOffset, dragStart.offset + percentDelta)));
  }, [isDragging, dragStart, zoom]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Hover handling
  const handleEventHover = useCallback((event, e) => {
    setHoveredEvent(event);
    if (e && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  const handleEventLeave = useCallback(() => {
    setHoveredEvent(null);
  }, []);

  // Click handling
  const handleEventClick = useCallback((event) => {
    onEventClick?.(event.id || event);
  }, [onEventClick]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '+' || e.key === '=') handleZoomIn();
      else if (e.key === '-') handleZoomOut();
      else if (e.key === '0') handleReset();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleReset]);

  const isZoomed = zoom > 1;

  return (
    <div className="timeline-view">
      <div className="timeline-header">
        <div className="timeline-title">Event Timeline</div>
        <div className="timeline-stats">
          {visibleEvents.length} events
          {isZoomed && (
            <span className="timeline-zoom-indicator">{zoom.toFixed(1)}x</span>
          )}
        </div>
        <div className="timeline-controls">
          <button onClick={handleZoomOut} disabled={zoom <= 1} title="Zoom out (-)">
            <ZoomOut size={16} />
          </button>
          <button onClick={handleZoomIn} disabled={zoom >= 10} title="Zoom in (+)">
            <ZoomIn size={16} />
          </button>
          <button onClick={handleReset} disabled={zoom === 1} title="Reset (0)">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="timeline-legend">
        {Object.entries(EVENT_TYPE_CONFIG).map(([type, config]) => {
          const Icon = config.icon;
          return (
            <div key={type} className="legend-item">
              <Icon size={12} style={{ color: config.color }} />
              <span>{config.label}</span>
            </div>
          );
        })}
      </div>

      <div
        ref={containerRef}
        className={`timeline-container ${isDragging ? 'dragging' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={() => { handleDragEnd(); handleEventLeave(); }}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        <svg ref={svgRef} className="timeline-svg" width="100%" height="120">
          {/* Time axis */}
          <line
            x1="0%"
            y1="60"
            x2="100%"
            y2="60"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1"
          />

          {/* Time ticks */}
          {timeTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={`${tick.position}%`}
                y1="55"
                x2={`${tick.position}%`}
                y2="65"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1"
              />
              <text
                x={`${tick.position}%`}
                y="80"
                textAnchor="middle"
                fill="rgba(255,255,255,0.5)"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Event markers */}
          {visibleEvents.map((event, i) => {
            const x = getEventPosition(event);
            const config = EVENT_TYPE_CONFIG[event.type] || EVENT_TYPE_CONFIG.session;
            const color = event.severity ? SEVERITY_COLORS[event.severity] : config.color;
            const isSelected = selectedEventId === event.id;
            const isHovered = hoveredEvent?.id === event.id;

            return (
              <g
                key={event.id || i}
                className={`timeline-event ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
                onMouseEnter={(e) => handleEventHover(event, e)}
                onMouseLeave={handleEventLeave}
                onClick={() => handleEventClick(event)}
                style={{ cursor: 'pointer' }}
              >
                {/* Vertical line */}
                <line
                  x1={`${x}%`}
                  y1="20"
                  x2={`${x}%`}
                  y2="55"
                  stroke={color}
                  strokeWidth={isSelected || isHovered ? 2 : 1}
                  opacity={isSelected || isHovered ? 1 : 0.6}
                />

                {/* Event marker */}
                <circle
                  cx={`${x}%`}
                  cy="15"
                  r={isSelected || isHovered ? 8 : 6}
                  fill={color}
                  stroke={isSelected ? '#fff' : 'none'}
                  strokeWidth="2"
                />

                {/* Pulse effect for selected */}
                {isSelected && (
                  <circle
                    cx={`${x}%`}
                    cy="15"
                    r="12"
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    opacity="0.3"
                    className="pulse-ring"
                  />
                )}
              </g>
            );
          })}

          {/* Current time indicator if within range */}
          {Date.now() >= visibleWindow.start && Date.now() <= visibleWindow.end && (
            <g>
              <line
                x1={`${((Date.now() - visibleWindow.start) / visibleWindow.duration) * 100}%`}
                y1="5"
                x2={`${((Date.now() - visibleWindow.start) / visibleWindow.duration) * 100}%`}
                y2="110"
                stroke="#fff"
                strokeWidth="1"
                strokeDasharray="3,3"
                opacity="0.5"
              />
              <text
                x={`${((Date.now() - visibleWindow.start) / visibleWindow.duration) * 100}%`}
                y="100"
                textAnchor="middle"
                fill="#fff"
                fontSize="9"
                opacity="0.5"
              >
                NOW
              </text>
            </g>
          )}
        </svg>

        {/* Tooltip */}
        {hoveredEvent && (
          <div
            className="timeline-tooltip"
            style={{
              left: `${Math.min(tooltipPosition.x, (containerRef.current?.offsetWidth || 300) - 200)}px`,
              top: `${tooltipPosition.y + 20}px`,
            }}
          >
            <div className="tooltip-header">
              <span
                className="tooltip-severity"
                style={{ background: SEVERITY_COLORS[hoveredEvent.severity] || SEVERITY_COLORS.default }}
              >
                {hoveredEvent.severity?.toUpperCase() || 'INFO'}
              </span>
              <span className="tooltip-type">{hoveredEvent.type?.replace(/_/g, ' ')}</span>
            </div>
            <div className="tooltip-time">
              {new Date(hoveredEvent.timestamp).toLocaleString()}
            </div>
            {hoveredEvent.message && (
              <div className="tooltip-message">{hoveredEvent.message}</div>
            )}
            {hoveredEvent.callsign && (
              <div className="tooltip-aircraft">{hoveredEvent.callsign}</div>
            )}
          </div>
        )}
      </div>

      {/* Mini overview bar for zoomed state */}
      {isZoomed && (
        <div className="timeline-overview">
          <div
            className="timeline-overview-window"
            style={{
              left: `${offset}%`,
              width: `${100 / zoom}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default TimelineView;
