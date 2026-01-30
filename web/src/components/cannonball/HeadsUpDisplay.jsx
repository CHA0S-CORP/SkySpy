/**
 * HeadsUpDisplay - Minimal glanceable display mode
 *
 * Shows only essential information optimized for quick glances:
 * - Large direction arrow
 * - Distance
 * - Threat color coding
 * - All clear state
 */
import React, { memo } from 'react';
import { Navigation2, Check, AlertTriangle } from 'lucide-react';
import { formatDistance } from './ThreatDisplay';

/**
 * HeadsUpDisplay component - minimal glanceable display mode
 * Shows only essential info: large direction arrow, distance, threat color
 */
export const HeadsUpDisplay = memo(function HeadsUpDisplay({
  threat,
  threatCount,
  userHeading,
  gpsActive,
}) {
  // No threats - show all clear
  if (!threat) {
    return (
      <div className="heads-up-display threat-level-info">
        <div className="heads-up-all-clear">
          <div className="heads-up-all-clear-icon">
            <Check size={60} color="#22c55e" />
          </div>
          <div className="heads-up-all-clear-text">ALL CLEAR</div>
        </div>
      </div>
    );
  }

  const threatLevel = threat.threat_level || 'info';
  const distance = formatDistance(threat.distance_nm);

  // Calculate relative bearing
  const rotation = userHeading !== null
    ? (threat.bearing - userHeading + 360) % 360
    : threat.bearing;

  return (
    <div className={`heads-up-display threat-level-${threatLevel}`}>
      {/* Large direction arrow */}
      <div
        className={`heads-up-arrow threat-${threatLevel}`}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <Navigation2 />
      </div>

      {/* Distance in corner */}
      <div className={`heads-up-distance threat-${threatLevel}`}>
        {distance.value} {distance.unit}
      </div>

      {/* Threat count indicator */}
      {threatCount > 1 && (
        <div className="heads-up-count">
          <AlertTriangle size={16} />
          <span>{threatCount}</span>
        </div>
      )}
    </div>
  );
});

export default HeadsUpDisplay;
