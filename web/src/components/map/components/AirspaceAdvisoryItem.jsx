import React, { useState } from 'react';
import {
  Cloud,
  Wind,
  Snowflake,
  CloudLightning,
  Mountain,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MapPin,
  Check,
  Eye,
} from 'lucide-react';
import { HAZARD_CONFIG } from '../../../hooks/useAirspaceAdvisories';

// Icon mapping for hazard types
const HAZARD_ICONS = {
  Cloud,
  Wind,
  Snowflake,
  CloudLightning,
  Mountain,
  AlertTriangle,
};

/**
 * Format altitude for display
 */
function formatAltitude(altFt) {
  if (altFt === null || altFt === undefined) return '--';
  if (altFt === 0) return 'SFC';
  if (altFt >= 18000) return `FL${Math.round(altFt / 100)}`;
  return `${altFt.toLocaleString()}ft`;
}

/**
 * Format time for display
 */
function formatTime(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  return date.toISOString().slice(11, 16) + 'Z';
}

/**
 * Check if advisory is expiring soon (within 2 hours)
 */
function isExpiringSoon(validTo) {
  if (!validTo) return false;
  const expiry = new Date(validTo);
  const now = new Date();
  const hoursUntilExpiry = (expiry - now) / (1000 * 60 * 60);
  return hoursUntilExpiry <= 2 && hoursUntilExpiry > 0;
}

/**
 * AirspaceAdvisoryItem component - displays a single advisory card
 */
export function AirspaceAdvisoryItem({
  advisory,
  isAcknowledged,
  onAcknowledge,
  onShowOnMap,
  isHighlighted,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hazardConfig = HAZARD_CONFIG[advisory.hazard] || {
    color: '#888888',
    icon: 'AlertTriangle',
    label: advisory.hazard || 'Unknown',
  };

  const IconComponent = HAZARD_ICONS[hazardConfig.icon] || AlertTriangle;
  const expiringSoon = isExpiringSoon(advisory.valid_to);

  return (
    <div
      className={`advisory-item ${isAcknowledged ? 'acknowledged' : ''} ${isHighlighted ? 'highlighted' : ''} ${expiringSoon ? 'expiring-soon' : ''}`}
      style={{ '--hazard-color': hazardConfig.color }}
    >
      {/* Collapsed header - always visible */}
      <button
        className="advisory-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className="advisory-hazard-badge" style={{ backgroundColor: hazardConfig.color }}>
          <IconComponent size={12} />
          <span>{advisory.hazard || 'UNK'}</span>
        </div>

        <div className="advisory-title">
          <span className="advisory-type">{advisory.advisory_type || 'ADVISORY'}</span>
          <span className="advisory-id">
            {advisory.id != null ? String(advisory.id).slice(-6) : '--'}
          </span>
        </div>

        <div className="advisory-meta">
          {advisory.lower_alt_ft !== undefined && advisory.upper_alt_ft !== undefined && (
            <span className="advisory-altitude">
              {formatAltitude(advisory.lower_alt_ft)}-{formatAltitude(advisory.upper_alt_ft)}
            </span>
          )}
        </div>

        <div className="advisory-expand-icon">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="advisory-content">
          {/* Time validity */}
          <div className="advisory-validity">
            <span className="validity-label">Valid:</span>
            <span className="validity-time">
              {formatTime(advisory.valid_from)} - {formatTime(advisory.valid_to)}
            </span>
            {expiringSoon && <span className="expiring-badge">Expiring Soon</span>}
          </div>

          {/* Region info */}
          {advisory.region && (
            <div className="advisory-region">
              <MapPin size={12} />
              <span>{advisory.region}</span>
            </div>
          )}

          {/* Raw text / description */}
          {advisory.raw_text && <div className="advisory-raw-text">{advisory.raw_text}</div>}

          {/* Action buttons */}
          <div className="advisory-actions">
            {advisory.polygon && (
              <button
                className="advisory-action-btn show-on-map"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowOnMap?.(advisory);
                }}
                title="Show on map"
              >
                <Eye size={14} />
                <span>Show on Map</span>
              </button>
            )}

            <button
              className={`advisory-action-btn acknowledge ${isAcknowledged ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge?.(advisory.id);
              }}
              title={isAcknowledged ? 'Acknowledged' : 'Acknowledge'}
            >
              <Check size={14} />
              <span>{isAcknowledged ? 'Acknowledged' : 'Acknowledge'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AirspaceAdvisoryItem;
