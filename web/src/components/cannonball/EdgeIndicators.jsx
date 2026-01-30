/**
 * EdgeIndicators - Peripheral vision threat indicators
 *
 * Highlights screen edges based on threat direction for
 * peripheral vision awareness while driving
 */
import React, { memo } from 'react';

/**
 * EdgeIndicators component - peripheral vision threat indicators
 */
export const EdgeIndicators = memo(function EdgeIndicators({ threats, userHeading }) {
  if (!threats || threats.length === 0) return null;

  // Get the most critical threat
  const criticalThreat = threats[0];
  if (!criticalThreat || criticalThreat.threat_level === 'info') return null;

  // Calculate relative bearing
  const bearing = userHeading !== null
    ? (criticalThreat.bearing - userHeading + 360) % 360
    : criticalThreat.bearing;

  // Determine which edge(s) to highlight
  const indicators = [];
  const color = criticalThreat.threat_level === 'critical' ? '#ef4444' : '#f59e0b';
  const intensity = criticalThreat.threat_level === 'critical' ? 0.7 : 0.4;

  // Map bearing to edge indicators
  if (bearing >= 315 || bearing < 45) {
    indicators.push({ direction: 'top', color, intensity });
  }
  if (bearing >= 45 && bearing < 135) {
    indicators.push({ direction: 'right', color, intensity });
  }
  if (bearing >= 135 && bearing < 225) {
    indicators.push({ direction: 'bottom', color, intensity });
  }
  if (bearing >= 225 && bearing < 315) {
    indicators.push({ direction: 'left', color, intensity });
  }

  return (
    <div className="edge-indicators">
      {indicators.map(({ direction, color: c, intensity: i }) => (
        <div
          key={direction}
          className={`edge-indicator ${direction}`}
          style={{ '--color': c, '--intensity': i }}
        />
      ))}
    </div>
  );
});

export default EdgeIndicators;
