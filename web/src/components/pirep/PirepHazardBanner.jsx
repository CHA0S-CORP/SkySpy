import React from 'react';
import { AlertTriangle, Wind, Snowflake, Zap } from 'lucide-react';

/**
 * Hazard banner for PIREP popup - shows prominent hazard summary at top
 * Color-coded background based on highest severity
 */
export function PirepHazardBanner({ decoded, severity }) {
  if (!decoded && !severity) return null;

  const severityLevel = severity?.level || 0;
  const isUrgent = severity?.isUrgent || decoded?.type === 'UUA';

  // Build hazard items
  const hazards = [];
  if (decoded?.turbulence && decoded.turbulence.level > 0) {
    hazards.push({
      icon: Wind,
      text: `${decoded.turbulence.intensity.toUpperCase()} TURB`,
      type: 'turbulence',
      level: decoded.turbulence.level,
    });
  }
  if (decoded?.icing && decoded.icing.level > 0) {
    hazards.push({
      icon: Snowflake,
      text: `${decoded.icing.intensity.toUpperCase()} ICE`,
      type: 'icing',
      level: decoded.icing.level,
    });
  }
  if (decoded?.windshear && decoded.windshear.level > 0) {
    hazards.push({
      icon: Zap,
      text: `${decoded.windshear.intensity.toUpperCase()} WS`,
      type: 'windshear',
      level: decoded.windshear.level,
    });
  }

  // Determine banner class based on severity
  let bannerClass = 'pirep-hazard-banner';
  if (isUrgent || severityLevel >= 5) {
    bannerClass += ' severe';
  } else if (severityLevel >= 3) {
    bannerClass += ' moderate';
  } else if (severityLevel >= 1) {
    bannerClass += ' light';
  } else {
    bannerClass += ' routine';
  }

  // If no hazards, show appropriate message
  if (hazards.length === 0) {
    if (isUrgent) {
      return (
        <div className={bannerClass}>
          <AlertTriangle size={16} />
          <span className="hazard-text">URGENT PILOT REPORT</span>
        </div>
      );
    }
    return (
      <div className={bannerClass}>
        <span className="hazard-text">ROUTINE REPORT</span>
      </div>
    );
  }

  return (
    <div className={bannerClass}>
      {isUrgent && <AlertTriangle size={16} className="urgent-icon" />}
      <div className="hazard-items">
        {hazards.map((hazard, idx) => (
          <span key={idx} className={`hazard-item ${hazard.type} level-${hazard.level}`}>
            <hazard.icon size={14} />
            {hazard.text}
          </span>
        ))}
      </div>
    </div>
  );
}

export default PirepHazardBanner;
