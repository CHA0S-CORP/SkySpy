/**
 * ThreatList - Secondary threats list display
 *
 * Shows a compact list of secondary threats below the main display
 * with quick selection functionality
 */
import React, { memo } from 'react';
import { getDirectionName } from '../../utils/lawEnforcement';

/**
 * ThreatList component - secondary threats
 */
export const ThreatList = memo(function ThreatList({ threats, onSelect }) {
  if (threats.length === 0) return null;

  return (
    <div className="threat-list">
      {threats.map((threat, index) => (
        <button
          key={threat.hex || index}
          className={`threat-item threat-${threat.threat_level}`}
          onClick={() => onSelect(threat)}
        >
          <span className="item-category">{threat.category}</span>
          <span className="item-distance">{threat.distance_nm.toFixed(1)} NM</span>
          <span className="item-direction">{getDirectionName(threat.bearing)}</span>
          {threat.urgencyScore >= 60 && (
            <span className="urgency-badge urgency-high">{threat.urgencyScore}</span>
          )}
        </button>
      ))}
    </div>
  );
});

export default ThreatList;
