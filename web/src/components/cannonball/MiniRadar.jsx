/**
 * MiniRadar - Radar-style threat visualization
 *
 * A circular radar display showing:
 * - User position at center
 * - Threat positions as blips
 * - Range rings at 5nm and 10nm
 * - Heading indicator (if available)
 * - Threat colors by level
 */
import React, { useMemo } from 'react';
import { Navigation2 } from 'lucide-react';

// Convert distance/bearing to x,y coordinates on radar
function threatToPosition(threat, radius, maxRange, userHeading) {
  // Normalize distance to radar radius
  const normalizedDist = Math.min(threat.distance_nm / maxRange, 1);
  const r = normalizedDist * radius;

  // Adjust bearing for user heading (if available) - 0 is up
  let adjustedBearing = threat.bearing;
  if (userHeading !== null && userHeading !== undefined) {
    adjustedBearing = (threat.bearing - userHeading + 360) % 360;
  }

  // Convert to radians (0 is up, clockwise)
  const radians = (adjustedBearing - 90) * (Math.PI / 180);

  return {
    x: radius + r * Math.cos(radians),
    y: radius + r * Math.sin(radians),
  };
}

// Threat level to color
const THREAT_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#22c55e',
};

export function MiniRadar({
  threats = [],
  userHeading = null,
  maxRange = 15, // nm
  size = 200,
  onThreatClick,
  expanded = false,
  className = '',
}) {
  const radius = size / 2;
  const padding = 10;
  const effectiveRadius = radius - padding;

  // Calculate threat positions
  const threatPositions = useMemo(() => {
    return threats.map(threat => ({
      ...threat,
      ...threatToPosition(threat, effectiveRadius, maxRange, userHeading),
    }));
  }, [threats, effectiveRadius, maxRange, userHeading]);

  // Range ring distances
  const rangeRings = [5, 10, maxRange];

  return (
    <div
      className={`mini-radar ${expanded ? 'expanded' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background */}
        <circle
          cx={radius}
          cy={radius}
          r={effectiveRadius}
          fill="rgba(0, 0, 0, 0.8)"
          stroke="rgba(34, 197, 94, 0.3)"
          strokeWidth="1"
        />

        {/* Range rings */}
        {rangeRings.map((range) => {
          const ringRadius = (range / maxRange) * effectiveRadius;
          return (
            <g key={range}>
              <circle
                cx={radius}
                cy={radius}
                r={ringRadius}
                fill="none"
                stroke="rgba(34, 197, 94, 0.2)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              {expanded && (
                <text
                  x={radius + ringRadius - 15}
                  y={radius - 5}
                  fill="rgba(34, 197, 94, 0.5)"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {range}nm
                </text>
              )}
            </g>
          );
        })}

        {/* Cardinal direction markers */}
        <text
          x={radius}
          y={padding + 12}
          fill="rgba(255, 255, 255, 0.5)"
          fontSize="10"
          textAnchor="middle"
          fontWeight="bold"
        >
          N
        </text>
        <text
          x={size - padding - 2}
          y={radius + 4}
          fill="rgba(255, 255, 255, 0.3)"
          fontSize="10"
          textAnchor="end"
        >
          E
        </text>
        <text
          x={radius}
          y={size - padding - 2}
          fill="rgba(255, 255, 255, 0.3)"
          fontSize="10"
          textAnchor="middle"
        >
          S
        </text>
        <text
          x={padding + 2}
          y={radius + 4}
          fill="rgba(255, 255, 255, 0.3)"
          fontSize="10"
          textAnchor="start"
        >
          W
        </text>

        {/* Crosshairs */}
        <line
          x1={radius}
          y1={padding}
          x2={radius}
          y2={size - padding}
          stroke="rgba(34, 197, 94, 0.15)"
          strokeWidth="1"
        />
        <line
          x1={padding}
          y1={radius}
          x2={size - padding}
          y2={radius}
          stroke="rgba(34, 197, 94, 0.15)"
          strokeWidth="1"
        />

        {/* Radar sweep animation (optional decorative) */}
        <defs>
          <linearGradient id="sweepGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(34, 197, 94, 0)" />
            <stop offset="100%" stopColor="rgba(34, 197, 94, 0.3)" />
          </linearGradient>
        </defs>

        {/* Threat blips */}
        {threatPositions.map((threat, index) => {
          const color = THREAT_COLORS[threat.threat_level] || THREAT_COLORS.info;
          const blipSize = threat.threat_level === 'critical' ? 8 : 6;

          return (
            <g
              key={threat.hex || index}
              className="radar-blip"
              onClick={() => onThreatClick?.(threat)}
              style={{ cursor: onThreatClick ? 'pointer' : 'default' }}
            >
              {/* Pulse effect for critical threats */}
              {threat.threat_level === 'critical' && (
                <circle
                  cx={threat.x + padding}
                  cy={threat.y + padding}
                  r={blipSize + 4}
                  fill="none"
                  stroke={color}
                  strokeWidth="1"
                  opacity="0.5"
                  className="radar-blip-pulse"
                />
              )}

              {/* Main blip */}
              <circle
                cx={threat.x + padding}
                cy={threat.y + padding}
                r={blipSize}
                fill={color}
                stroke="rgba(255, 255, 255, 0.5)"
                strokeWidth="1"
              />

              {/* Direction indicator (small arrow showing aircraft heading) */}
              {threat.ground_speed > 50 && (
                <line
                  x1={threat.x + padding}
                  y1={threat.y + padding}
                  x2={threat.x + padding + Math.cos((threat.bearing - 90) * Math.PI / 180) * 12}
                  y2={threat.y + padding + Math.sin((threat.bearing - 90) * Math.PI / 180) * 12}
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.7"
                />
              )}

              {/* Label for expanded mode */}
              {expanded && (
                <text
                  x={threat.x + padding + 10}
                  y={threat.y + padding + 4}
                  fill={color}
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {threat.distance_nm.toFixed(1)}
                </text>
              )}
            </g>
          );
        })}

        {/* Center marker (user position) */}
        <circle
          cx={radius}
          cy={radius}
          r={4}
          fill="#3b82f6"
          stroke="white"
          strokeWidth="2"
        />

        {/* User heading indicator */}
        {userHeading !== null && userHeading !== undefined && (
          <g transform={`rotate(${userHeading}, ${radius}, ${radius})`}>
            <polygon
              points={`${radius},${radius - 15} ${radius - 5},${radius - 5} ${radius + 5},${radius - 5}`}
              fill="#3b82f6"
              opacity="0.8"
            />
          </g>
        )}
      </svg>

      {/* Legend for expanded mode */}
      {expanded && (
        <div className="radar-legend">
          <span className="legend-item critical">● Critical</span>
          <span className="legend-item warning">● Warning</span>
          <span className="legend-item info">● Clear</span>
        </div>
      )}
    </div>
  );
}

export default MiniRadar;
