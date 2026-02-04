/**
 * ConflictProbePanel - Displays predicted conflicts
 *
 * Phase 3.4: Conflict Probe (Look-Ahead)
 *
 * Shows a list of predicted conflicts with alert levels:
 * - RED: Conflict predicted in < 1 minute
 * - ORANGE: Conflict predicted in 1-2 minutes
 * - YELLOW: Conflict predicted in 2-5 minutes
 */
import React, { memo, useState, useCallback } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Crosshair,
  X,
  Eye,
  EyeOff,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Plane,
  Clock,
  Navigation,
} from 'lucide-react';

/**
 * Format time to conflict as human readable string
 */
function formatTimeToConflict(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 5) {
    return `${mins}m`;
  }
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Get alert level class name
 */
function getAlertLevelClass(level) {
  switch (level) {
    case 'red':
      return 'conflict-level-red';
    case 'orange':
      return 'conflict-level-orange';
    case 'yellow':
      return 'conflict-level-yellow';
    default:
      return '';
  }
}

/**
 * Get alert level label
 */
function getAlertLevelLabel(level) {
  switch (level) {
    case 'red':
      return 'CRITICAL';
    case 'orange':
      return 'WARNING';
    case 'yellow':
      return 'ADVISORY';
    default:
      return '';
  }
}

/**
 * Get vertical trend icon based on altitude change
 */
function getVerticalTrendIcon(currentAlt, predictedAlt) {
  const diff = predictedAlt - currentAlt;
  if (diff > 100) return ArrowUpRight;
  if (diff < -100) return ArrowDownRight;
  return ArrowRight;
}

/**
 * Individual conflict item
 */
const ConflictItem = memo(function ConflictItem({
  conflict,
  isExpanded,
  onToggle,
  onSelectAircraft,
  onCenterConflict,
  isPro,
}) {
  const { aircraft1, aircraft2, cpa, alertLevel } = conflict;

  const TrendIcon1 = getVerticalTrendIcon(aircraft1.altitude, aircraft1.altitudeAtCPA);
  const TrendIcon2 = getVerticalTrendIcon(aircraft2.altitude, aircraft2.altitudeAtCPA);

  return (
    <div
      className={`conflict-probe-item ${getAlertLevelClass(alertLevel)} ${isPro ? 'pro-style' : ''}`}
      role="listitem"
    >
      {/* Header row */}
      <button
        className="conflict-item-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${getAlertLevelLabel(alertLevel)} conflict between ${aircraft1.callsign} and ${aircraft2.callsign} in ${formatTimeToConflict(cpa.timeSeconds)}`}
      >
        <div className="conflict-item-alert">
          <AlertTriangle size={16} className="conflict-alert-icon" />
          <span className="conflict-alert-label">{getAlertLevelLabel(alertLevel)}</span>
        </div>

        <div className="conflict-item-pair">
          <span className="conflict-callsign">{aircraft1.callsign}</span>
          <span className="conflict-separator">-</span>
          <span className="conflict-callsign">{aircraft2.callsign}</span>
        </div>

        <div className="conflict-item-time">
          <Clock size={12} />
          <span>{formatTimeToConflict(cpa.timeSeconds)}</span>
        </div>

        <div className="conflict-item-toggle">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="conflict-item-details">
          {/* Separation info */}
          <div className="conflict-separation-row">
            <div className="conflict-sep-item">
              <span className="conflict-sep-label">LATERAL</span>
              <span className="conflict-sep-value">{cpa.lateralNm}nm</span>
            </div>
            <div className="conflict-sep-item">
              <span className="conflict-sep-label">VERTICAL</span>
              <span className="conflict-sep-value">{cpa.verticalFt}ft</span>
            </div>
          </div>

          {/* Aircraft 1 details */}
          <div className="conflict-aircraft-row">
            <div className="conflict-aircraft-header">
              <Plane size={12} />
              <span
                className="conflict-aircraft-callsign"
                onClick={() => onSelectAircraft(aircraft1.hex)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onSelectAircraft(aircraft1.hex)}
              >
                {aircraft1.callsign}
              </span>
            </div>
            <div className="conflict-aircraft-data">
              <span className="conflict-data-item">
                <TrendIcon1 size={10} />
                {aircraft1.altitude.toLocaleString()}ft - {aircraft1.altitudeAtCPA.toLocaleString()}
                ft
              </span>
              <span className="conflict-data-item">
                <Navigation size={10} />
                {aircraft1.track?.toFixed(0)}
              </span>
              <span className="conflict-data-item">{aircraft1.groundSpeed?.toFixed(0)}kts</span>
            </div>
          </div>

          {/* Aircraft 2 details */}
          <div className="conflict-aircraft-row">
            <div className="conflict-aircraft-header">
              <Plane size={12} />
              <span
                className="conflict-aircraft-callsign"
                onClick={() => onSelectAircraft(aircraft2.hex)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onSelectAircraft(aircraft2.hex)}
              >
                {aircraft2.callsign}
              </span>
            </div>
            <div className="conflict-aircraft-data">
              <span className="conflict-data-item">
                <TrendIcon2 size={10} />
                {aircraft2.altitude.toLocaleString()}ft - {aircraft2.altitudeAtCPA.toLocaleString()}
                ft
              </span>
              <span className="conflict-data-item">
                <Navigation size={10} />
                {aircraft2.track?.toFixed(0)}
              </span>
              <span className="conflict-data-item">{aircraft2.groundSpeed?.toFixed(0)}kts</span>
            </div>
          </div>

          {/* Actions */}
          <div className="conflict-actions">
            <button
              className="conflict-action-btn"
              onClick={() => onCenterConflict(conflict)}
              title="Center on conflict point"
            >
              <Crosshair size={12} />
              <span>Center</span>
            </button>
            <button
              className="conflict-action-btn"
              onClick={() => onSelectAircraft(aircraft1.hex)}
              title={`Select ${aircraft1.callsign}`}
            >
              <Eye size={12} />
              <span>{aircraft1.callsign}</span>
            </button>
            <button
              className="conflict-action-btn"
              onClick={() => onSelectAircraft(aircraft2.hex)}
              title={`Select ${aircraft2.callsign}`}
            >
              <Eye size={12} />
              <span>{aircraft2.callsign}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * ConflictProbePanel component
 */
export function ConflictProbePanel({
  conflicts,
  stats,
  enabled,
  onToggleEnabled,
  onSelectAircraft,
  onCenterConflict,
  isPro = false,
  isCollapsed = false,
  onToggleCollapse,
  onClose,
}) {
  const [expandedConflicts, setExpandedConflicts] = useState(new Set());

  const handleToggleExpanded = useCallback((conflictId) => {
    setExpandedConflicts((prev) => {
      const next = new Set(prev);
      if (next.has(conflictId)) {
        next.delete(conflictId);
      } else {
        next.add(conflictId);
      }
      return next;
    });
  }, []);

  // Don't render if disabled and no conflicts
  if (!enabled && conflicts.length === 0) {
    return null;
  }

  return (
    <div
      className={`conflict-probe-panel ${isPro ? 'pro-style' : ''} ${isCollapsed ? 'collapsed' : ''}`}
      role="region"
      aria-label="Conflict Probe Panel"
    >
      {/* Header */}
      <div className="conflict-probe-header">
        <button
          className="conflict-probe-toggle"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand conflict probe panel' : 'Collapse conflict probe panel'}
        >
          <AlertTriangle size={16} className="conflict-probe-icon" />
          <span className="conflict-probe-title">CONFLICT PROBE</span>

          {/* Badge with counts */}
          {conflicts.length > 0 && (
            <div className="conflict-probe-badges">
              {stats.red > 0 && (
                <span className="conflict-badge conflict-level-red">{stats.red}</span>
              )}
              {stats.orange > 0 && (
                <span className="conflict-badge conflict-level-orange">{stats.orange}</span>
              )}
              {stats.yellow > 0 && (
                <span className="conflict-badge conflict-level-yellow">{stats.yellow}</span>
              )}
            </div>
          )}

          {conflicts.length === 0 && (
            <span className="conflict-probe-clear">CLEAR</span>
          )}

          <div className="conflict-toggle-icon">
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </div>
        </button>

        {/* Enable/disable toggle */}
        <button
          className={`conflict-probe-enable ${enabled ? 'active' : ''}`}
          onClick={onToggleEnabled}
          title={enabled ? 'Disable conflict probe' : 'Enable conflict probe'}
          aria-pressed={enabled}
        >
          {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        {/* Close button */}
        {onClose && (
          <button className="conflict-probe-close" onClick={onClose} title="Close panel">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="conflict-probe-content">
          {conflicts.length === 0 ? (
            <div className="conflict-probe-empty">
              <span>No predicted conflicts</span>
              <span className="conflict-probe-subtitle">Monitoring {enabled ? 'active' : 'paused'}</span>
            </div>
          ) : (
            <div className="conflict-probe-list" role="list">
              {conflicts.map((conflict) => (
                <ConflictItem
                  key={conflict.id}
                  conflict={conflict}
                  isExpanded={expandedConflicts.has(conflict.id)}
                  onToggle={() => handleToggleExpanded(conflict.id)}
                  onSelectAircraft={onSelectAircraft}
                  onCenterConflict={onCenterConflict}
                  isPro={isPro}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ConflictProbePanel;
