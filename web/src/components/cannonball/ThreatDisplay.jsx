/**
 * ThreatDisplay - Main threat information display for single mode
 *
 * Shows detailed information about the primary threat including:
 * - Direction arrow (relative to user heading)
 * - Distance display
 * - Trend indicator (approaching/departing)
 * - Urgency score
 * - Behavior patterns
 * - Mini radar overlay
 */
import React, { memo } from 'react';
import {
  Navigation2, ChevronUp, ChevronDown, Minus,
  AlertTriangle, Target, Circle, RefreshCw,
} from 'lucide-react';
import { getDirectionName } from '../../utils/lawEnforcement';
import { MiniRadar } from './MiniRadar';

/**
 * DirectionArrow component - rotates based on threat bearing
 */
export const DirectionArrow = memo(function DirectionArrow({
  bearing,
  userHeading,
  threatLevel,
  size = 80,
}) {
  // Calculate relative bearing if user heading is available
  const rotation = userHeading !== null
    ? (bearing - userHeading + 360) % 360
    : bearing;

  return (
    <div
      className={`direction-arrow threat-${threatLevel}`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <Navigation2 size={size} />
    </div>
  );
});

/**
 * Format distance for display
 */
export function formatDistance(nm) {
  if (nm < 0.5) {
    const feet = Math.round(nm * 6076.12 / 100) * 100;
    return { value: feet, unit: 'FT' };
  } else if (nm < 10) {
    return { value: nm.toFixed(1), unit: 'NM' };
  } else {
    return { value: Math.round(nm), unit: 'NM' };
  }
}

/**
 * Get urgency level from score
 */
export function getUrgencyLevel(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * ThreatDisplay component - main threat information (single mode)
 */
export const ThreatDisplay = memo(function ThreatDisplay({
  threat,
  userHeading,
  showMiniRadar,
  threats,
  onThreatClick,
  showUrgency = true,
  showAgencyInfo = true,
  showPatternDetails = true,
}) {
  const threatLevel = threat.threat_level || 'info';
  const distance = formatDistance(threat.distance_nm);

  // Trend indicator
  const TrendIcon = threat.trend === 'approaching' ? ChevronDown
    : threat.trend === 'departing' ? ChevronUp
    : Minus;

  // Calculate urgency display
  const urgencyLevel = threat.urgencyScore ? getUrgencyLevel(threat.urgencyScore) : null;

  return (
    <div className={`threat-display threat-${threatLevel}`}>
      <div className="threat-header">
        <span className="threat-category">{threat.category || 'AIRCRAFT'}</span>
        {threat.callsign && (
          <span className="threat-callsign">{threat.callsign}</span>
        )}
        {/* Show agency name if known (from backend) */}
        {showAgencyInfo && threat.agencyName && (
          <span className="threat-agency">{threat.agencyName}</span>
        )}
        {/* Show known LE badge */}
        {threat.knownLE && (
          <span className="known-le-badge">KNOWN LE</span>
        )}
        {showUrgency && urgencyLevel && (
          <span className={`urgency-badge urgency-${urgencyLevel}`}>
            <AlertTriangle size={12} />
            {threat.urgencyScore}
          </span>
        )}
      </div>

      <div className="threat-main">
        <DirectionArrow
          bearing={threat.bearing}
          userHeading={userHeading}
          threatLevel={threatLevel}
        />

        <div className="distance-display">
          <span className="distance-value">{distance.value}</span>
          <span className="distance-unit">{distance.unit}</span>
        </div>

        <div className="direction-label">
          {getDirectionName(threat.bearing)}
        </div>
      </div>

      <div className="threat-footer">
        <div className="threat-info">
          <span className={`trend-indicator ${threat.trend}`}>
            <TrendIcon size={20} />
            {threat.trend?.toUpperCase() || 'UNKNOWN'}
          </span>
        </div>

        {/* Predictive alerts */}
        {threat.prediction && (
          <div className="threat-predictions">
            {threat.prediction.willIntercept && (
              <span className="intercept-warning">
                <Target size={14} />
                INTERCEPT
              </span>
            )}
            {threat.closingSpeed > 100 && threat.trend === 'approaching' && (
              <span className="prediction-badge closing-fast">
                CLOSING FAST ({Math.round(threat.closingSpeed)} kt)
              </span>
            )}
            {threat.behavior?.isCircling && (
              <span className="prediction-badge circling">
                <Circle size={12} />
                CIRCLING
              </span>
            )}
            {threat.behavior?.isLoitering && (
              <span className="prediction-badge loitering">
                LOITERING {threat.behavior.duration}m
              </span>
            )}
          </div>
        )}

        {/* Backend pattern badges */}
        {showPatternDetails && threat.patterns && threat.patterns.length > 0 && (
          <div className="pattern-badges">
            {threat.patterns.map((pattern, idx) => (
              <span key={idx} className={`pattern-badge ${pattern.type || pattern.pattern_type}`}>
                {pattern.type === 'circling' && <RefreshCw size={10} />}
                {pattern.type === 'grid_search' && <Target size={10} />}
                {(pattern.type || pattern.pattern_type || 'unknown').replace('_', ' ').toUpperCase()}
                {pattern.confidence_score && ` (${Math.round(pattern.confidence_score * 100)}%)`}
              </span>
            ))}
          </div>
        )}

        <div className="threat-details">
          {threat.altitude && (
            <span className="detail">{Math.round(threat.altitude).toLocaleString()} FT</span>
          )}
          {threat.ground_speed && (
            <span className="detail">{Math.round(threat.ground_speed)} KTS</span>
          )}
        </div>
      </div>

      {/* Mini radar overlay */}
      {showMiniRadar && threats.length > 0 && (
        <div className="mini-radar-overlay">
          <MiniRadar
            threats={threats}
            userHeading={userHeading}
            size={120}
            maxRange={15}
            onThreatClick={onThreatClick}
          />
        </div>
      )}
    </div>
  );
});

export default ThreatDisplay;
