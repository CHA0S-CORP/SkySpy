import { useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * PolarPlotEnhanced - Enhanced antenna polar diagram for coverage visualization
 */
export function PolarPlotEnhanced({
  data = [],
  size = 200,
  maxRange = 250,
  showGrid = true,
  showLabels = true,
  showLegend = true,
  colorByAltitude = false,
  colorBySignal = false,
  dotSize = 3,
  highlightedPoints = [],
  onPointClick,
  onPointHover,
  // feederLocation, // Reserved for future use
  className = '',
}) {
  const svgRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const center = size / 2;
  const padding = 20;
  const plotRadius = (size - padding * 2) / 2;

  // Convert data points to polar coordinates
  const polarPoints = useMemo(() => {
    return data.map((point, index) => {
      const bearing = point.bearing || point.track || 0;
      const range = point.range || point.distance || 0;
      const altitude = point.altitude || 0;
      const signal = point.rssi || point.signal || -100;

      // Normalize range to plot radius
      const normalizedRange = Math.min(range / maxRange, 1) * plotRadius;

      // Convert bearing to radians (0° = North = top)
      const angleRad = ((bearing - 90) * Math.PI) / 180;

      // Calculate x, y coordinates
      const x = center + normalizedRange * Math.cos(angleRad);
      const y = center + normalizedRange * Math.sin(angleRad);

      // Determine color based on settings
      let color = 'var(--accent-cyan)';
      if (colorByAltitude) {
        if (altitude < 10000) color = 'var(--viz-altitude-low)';
        else if (altitude < 30000) color = 'var(--viz-altitude-mid)';
        else color = 'var(--viz-altitude-high)';
      } else if (colorBySignal) {
        if (signal > -5) color = 'var(--viz-signal-excellent)';
        else if (signal > -10) color = 'var(--viz-signal-good)';
        else if (signal > -15) color = 'var(--viz-signal-fair)';
        else color = 'var(--viz-signal-weak)';
      }

      const isHighlighted = highlightedPoints.includes(point.id || index);

      return {
        ...point,
        x,
        y,
        color,
        isHighlighted,
        index,
      };
    });
  }, [data, maxRange, plotRadius, center, colorByAltitude, colorBySignal, highlightedPoints]);

  // Generate grid circles
  const gridCircles = useMemo(() => {
    const circles = [];
    const ringCount = 4;
    for (let i = 1; i <= ringCount; i++) {
      const radius = (plotRadius / ringCount) * i;
      const rangeLabel = Math.round((maxRange / ringCount) * i);
      circles.push({ radius, label: `${rangeLabel}nm` });
    }
    return circles;
  }, [plotRadius, maxRange]);

  // Generate bearing lines and labels
  const bearingLines = useMemo(() => {
    const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

    return bearings.map((bearing, i) => {
      const angleRad = ((bearing - 90) * Math.PI) / 180;
      const x2 = center + plotRadius * Math.cos(angleRad);
      const y2 = center + plotRadius * Math.sin(angleRad);
      const labelX = center + (plotRadius + 12) * Math.cos(angleRad);
      const labelY = center + (plotRadius + 12) * Math.sin(angleRad);

      return {
        x1: center,
        y1: center,
        x2,
        y2,
        labelX,
        labelY,
        label: labels[i],
      };
    });
  }, [center, plotRadius]);

  const handlePointInteraction = (point, type) => {
    if (type === 'click') {
      onPointClick?.(point);
    } else if (type === 'enter') {
      setHoveredPoint(point);
      onPointHover?.(point);
    } else {
      setHoveredPoint(null);
      onPointHover?.(null);
    }
  };

  return (
    <div
      className={`polar-plot-enhanced ${className}`}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: 'visible' }}
      >
        {/* Background */}
        <circle
          cx={center}
          cy={center}
          r={plotRadius}
          fill="var(--bg-card)"
          stroke="var(--border)"
          strokeWidth="1"
        />

        {/* Grid circles */}
        {showGrid && gridCircles.map((circle, i) => (
          <g key={`circle-${i}`}>
            <circle
              cx={center}
              cy={center}
              r={circle.radius}
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray={i < gridCircles.length - 1 ? '2,4' : 'none'}
              opacity={0.5}
            />
            {showLabels && (
              <text
                x={center + 4}
                y={center - circle.radius + 3}
                fontSize="9"
                fill="var(--text-dim)"
                fontFamily="'JetBrains Mono', monospace"
              >
                {circle.label}
              </text>
            )}
          </g>
        ))}

        {/* Bearing lines */}
        {showGrid && bearingLines.map((line, i) => (
          <g key={`bearing-${i}`}>
            <line
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="2,4"
              opacity={0.3}
            />
            {showLabels && (
              <text
                x={line.labelX}
                y={line.labelY}
                fontSize="10"
                fill="var(--text-secondary)"
                textAnchor="middle"
                dominantBaseline="middle"
                fontWeight={line.label === 'N' ? '600' : '400'}
              >
                {line.label}
              </text>
            )}
          </g>
        ))}

        {/* Center point (feeder location) */}
        <circle
          cx={center}
          cy={center}
          r={4}
          fill="var(--accent-red)"
          stroke="var(--bg-dark)"
          strokeWidth="2"
        />

        {/* Data points */}
        {polarPoints.map((point) => (
          <circle
            key={point.index}
            cx={point.x}
            cy={point.y}
            r={point.isHighlighted ? dotSize + 2 : dotSize}
            fill={point.color}
            opacity={point.isHighlighted ? 1 : 0.7}
            stroke={point.isHighlighted ? 'white' : 'none'}
            strokeWidth={point.isHighlighted ? 2 : 0}
            style={{
              cursor: onPointClick ? 'pointer' : 'default',
              transition: 'r 0.15s ease, opacity 0.15s ease',
            }}
            onClick={() => handlePointInteraction(point, 'click')}
            onMouseEnter={() => handlePointInteraction(point, 'enter')}
            onMouseLeave={() => handlePointInteraction(point, 'leave')}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div
          style={{
            position: 'absolute',
            left: hoveredPoint.x,
            top: hoveredPoint.y - 40,
            transform: 'translateX(-50%)',
            padding: '4px 8px',
            background: 'var(--bg-dark)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '10px',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {hoveredPoint.callsign || hoveredPoint.icao || `Point ${hoveredPoint.index}`}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {Math.round(hoveredPoint.bearing || 0)}° / {(hoveredPoint.range || 0).toFixed(1)}nm
            {hoveredPoint.altitude && ` / ${hoveredPoint.altitude.toLocaleString()}ft`}
          </div>
        </div>
      )}

      {/* Legend */}
      {showLegend && (colorByAltitude || colorBySignal) && (
        <div
          style={{
            position: 'absolute',
            bottom: -30,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '12px',
            fontSize: '9px',
            color: 'var(--text-dim)',
          }}
        >
          {colorByAltitude && (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-altitude-low)' }} />
                &lt;10k
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-altitude-mid)' }} />
                10-30k
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-altitude-high)' }} />
                &gt;30k
              </span>
            </>
          )}
          {colorBySignal && (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-signal-excellent)' }} />
                Excellent
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-signal-good)' }} />
                Good
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-signal-fair)' }} />
                Fair
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--viz-signal-weak)' }} />
                Weak
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

PolarPlotEnhanced.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      bearing: PropTypes.number,
      track: PropTypes.number,
      range: PropTypes.number,
      distance: PropTypes.number,
      altitude: PropTypes.number,
      rssi: PropTypes.number,
      signal: PropTypes.number,
      callsign: PropTypes.string,
      icao: PropTypes.string,
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    })
  ),
  size: PropTypes.number,
  maxRange: PropTypes.number,
  showGrid: PropTypes.bool,
  showLabels: PropTypes.bool,
  showLegend: PropTypes.bool,
  colorByAltitude: PropTypes.bool,
  colorBySignal: PropTypes.bool,
  dotSize: PropTypes.number,
  highlightedPoints: PropTypes.array,
  onPointClick: PropTypes.func,
  onPointHover: PropTypes.func,
  feederLocation: PropTypes.object,
  className: PropTypes.string,
};

export default PolarPlotEnhanced;
