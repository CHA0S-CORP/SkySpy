import React from 'react';
import { Clock } from 'lucide-react';
import { getPirepAgeMinutes, getAgeFreshnessClass } from '../../utils';

/**
 * Time and freshness indicator for PIREPs
 * Shows observation time and relative age with color-coded badge
 */
export function TimeFreshnessIndicator({ pirep, decoded }) {
  const obsTime = pirep?.observation_time || pirep?.obsTime;
  const displayTime = decoded?.time;

  if (!obsTime && !displayTime) return null;

  const ageMinutes = getPirepAgeMinutes(pirep);
  const freshnessClass = getAgeFreshnessClass(ageMinutes);

  // Format relative time
  let relativeText = '';
  if (ageMinutes >= 0) {
    if (ageMinutes < 60) {
      relativeText = `${ageMinutes} min ago`;
    } else if (ageMinutes < 120) {
      const hrs = Math.floor(ageMinutes / 60);
      const mins = ageMinutes % 60;
      relativeText = mins > 0 ? `${hrs}h ${mins}m ago` : `${hrs}h ago`;
    } else {
      const hrs = Math.floor(ageMinutes / 60);
      relativeText = `${hrs}h ago`;
    }
  }

  return (
    <div className="time-freshness-indicator">
      <Clock size={14} />
      <span className="time-value">{displayTime || 'Unknown'}</span>
      {relativeText && (
        <span className={`freshness-badge ${freshnessClass}`}>{relativeText}</span>
      )}
    </div>
  );
}

export default TimeFreshnessIndicator;
