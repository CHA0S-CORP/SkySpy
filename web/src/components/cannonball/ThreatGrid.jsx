/**
 * ThreatGrid - Multi-threat dashboard view
 *
 * Displays up to 4 threats simultaneously in a grid layout:
 * - Each cell shows direction, distance, category
 * - Color-coded by threat level
 * - Tap to focus on specific threat
 * - Auto-cycle mode option
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Navigation2, ChevronUp, ChevronDown, Minus, Clock } from 'lucide-react';
import { formatETA } from '../../utils/threatPrediction';
import { getDirectionName } from '../../utils/lawEnforcement';

const THREAT_COLORS = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#22c55e',
};

function ThreatCell({ threat, userHeading, onSelect, isSelected, showEta = false }) {
  if (!threat) {
    return (
      <div className="threat-cell empty">
        <span className="empty-text">—</span>
      </div>
    );
  }

  const color = THREAT_COLORS[threat.threat_level] || THREAT_COLORS.info;

  // Calculate relative bearing for arrow rotation
  const rotation = userHeading !== null
    ? (threat.bearing - userHeading + 360) % 360
    : threat.bearing;

  // Format distance
  const formatDistance = (nm) => {
    if (nm < 0.5) {
      return `${Math.round(nm * 6076 / 100) * 100}ft`;
    } else if (nm < 10) {
      return `${nm.toFixed(1)}nm`;
    }
    return `${Math.round(nm)}nm`;
  };

  // Trend icon
  const TrendIcon = threat.trend === 'approaching' ? ChevronDown
    : threat.trend === 'departing' ? ChevronUp
    : Minus;

  return (
    <button
      className={`threat-cell threat-${threat.threat_level} ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect?.(threat)}
      style={{ '--threat-color': color }}
    >
      {/* Direction arrow */}
      <div className="cell-arrow" style={{ transform: `rotate(${rotation}deg)` }}>
        <Navigation2 size={32} />
      </div>

      {/* Distance */}
      <div className="cell-distance">
        {formatDistance(threat.distance_nm)}
      </div>

      {/* Category */}
      <div className="cell-category">
        {threat.category || 'Aircraft'}
      </div>

      {/* Direction label */}
      <div className="cell-direction">
        {getDirectionName(threat.bearing)}
      </div>

      {/* Trend indicator */}
      <div className={`cell-trend ${threat.trend}`}>
        <TrendIcon size={14} />
      </div>

      {/* ETA if available */}
      {showEta && threat.eta !== null && threat.eta !== undefined && (
        <div className="cell-eta">
          <Clock size={10} />
          {formatETA(threat.eta)}
        </div>
      )}

      {/* Callsign if available */}
      {threat.callsign && (
        <div className="cell-callsign">{threat.callsign}</div>
      )}
    </button>
  );
}

export function ThreatGrid({
  threats = [],
  userHeading = null,
  maxDisplay = 4,
  onSelectThreat,
  selectedThreat = null,
  autoCycle = false,
  cycleInterval = 5000,
  showEta = false,
}) {
  const [cycleIndex, setCycleIndex] = useState(0);

  // Auto-cycle through threats
  useEffect(() => {
    if (!autoCycle || threats.length <= 1) return;

    const interval = setInterval(() => {
      setCycleIndex(prev => (prev + 1) % threats.length);
    }, cycleInterval);

    return () => clearInterval(interval);
  }, [autoCycle, cycleInterval, threats.length]);

  // Handle threat selection
  const handleSelect = useCallback((threat) => {
    onSelectThreat?.(threat);
  }, [onSelectThreat]);

  // Get threats to display (immutable - don't mutate the sliced array)
  const displayThreats = [
    ...threats.slice(0, maxDisplay),
    ...Array(Math.max(0, maxDisplay - threats.length)).fill(null)
  ];

  // Determine grid layout based on count
  const getGridClass = () => {
    const count = threats.length;
    if (count <= 1) return 'grid-1';
    if (count === 2) return 'grid-2';
    if (count === 3) return 'grid-3';
    return 'grid-4';
  };

  return (
    <div className={`threat-grid ${getGridClass()}`}>
      {displayThreats.map((threat, index) => (
        <ThreatCell
          key={threat?.hex || `empty-${index}`}
          threat={threat}
          userHeading={userHeading}
          onSelect={handleSelect}
          isSelected={selectedThreat?.hex === threat?.hex}
          showEta={showEta}
        />
      ))}

      {/* Auto-cycle indicator */}
      {autoCycle && threats.length > maxDisplay && (
        <div className="cycle-indicator">
          <span>{cycleIndex + 1} / {threats.length}</span>
        </div>
      )}
    </div>
  );
}

export default ThreatGrid;
