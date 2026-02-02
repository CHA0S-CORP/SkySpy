import React, { useState } from 'react';
import {
  Info,
  AlertCircle,
  Shield,
  Navigation,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MapPin,
  Clock,
  Check,
  Eye,
  AlertTriangle,
  AlertOctagon,
} from 'lucide-react';
import { NOTAM_TYPE_CONFIG } from '../../../hooks/useNotams';

// Icon mapping for NOTAM types
const NOTAM_ICONS = {
  Info,
  AlertCircle,
  Shield,
  Navigation,
  ExternalLink,
};

// Severity configuration
const SEVERITY_CONFIG = {
  critical: { icon: AlertOctagon, color: '#dc2626', label: 'Critical' },
  moderate: { icon: AlertCircle, color: '#f59e0b', label: 'Moderate' },
  advisory: { icon: Info, color: '#3b82f6', label: 'Advisory' },
};

/**
 * Format date for display
 */
function formatDate(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  return (
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' +
    date.toISOString().slice(11, 16) +
    'Z'
  );
}

/**
 * Check if NOTAM is expiring soon (within 24 hours)
 */
function isExpiringSoon(effectiveEnd, isPermanent) {
  if (isPermanent || !effectiveEnd) return false;
  const expiry = new Date(effectiveEnd);
  const now = new Date();
  const hoursUntilExpiry = (expiry - now) / (1000 * 60 * 60);
  return hoursUntilExpiry <= 24 && hoursUntilExpiry > 0;
}

/**
 * NotamItem component - displays a single NOTAM card for pro mode map
 */
export function NotamItem({ notam, isAcknowledged, onAcknowledge, onShowOnMap, isHighlighted }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const typeConfig = NOTAM_TYPE_CONFIG[notam.type] || {
    color: '#6b7280',
    icon: 'Info',
    label: notam.type || 'NOTAM',
  };

  const IconComponent = NOTAM_ICONS[typeConfig.icon] || Info;
  const isActive = new Date(notam.effective_start) <= new Date();
  const isPermanent = notam.is_permanent;
  const expiringSoon = isExpiringSoon(notam.effective_end, isPermanent);

  // Check if NOTAM has location data for map display
  const hasLocation = notam.latitude && notam.longitude;

  // Get decoded data from backend
  const decoded = notam.decoded;
  const severity = notam.severity || decoded?.severity || 'advisory';
  const humanSummary = notam.human_summary || decoded?.human_summary;
  const severityConfig = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.advisory;
  const SeverityIcon = severityConfig.icon;

  return (
    <div
      className={`notam-item ${isAcknowledged ? 'acknowledged' : ''} ${isHighlighted ? 'highlighted' : ''} ${expiringSoon ? 'expiring-soon' : ''} ${notam.type === 'TFR' ? 'tfr' : ''} severity-${severity}`}
      style={{ '--notam-color': typeConfig.color, '--severity-color': severityConfig.color }}
    >
      {/* Collapsed header - always visible */}
      <button
        className="notam-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className="notam-type-badge" style={{ backgroundColor: typeConfig.color }}>
          <IconComponent size={12} />
          <span>{notam.type || 'D'}</span>
        </div>

        {/* Severity badge */}
        <div
          className="notam-severity-badge"
          style={{ backgroundColor: severityConfig.color }}
          title={severityConfig.label}
        >
          <SeverityIcon size={10} />
        </div>

        <div className="notam-title">
          <span className="notam-location-name">{notam.location || 'Unknown'}</span>
          <span className="notam-id">{notam.notam_id}</span>
        </div>

        <div className="notam-status">
          {isPermanent ? (
            <span className="permanent-badge">PERM</span>
          ) : isActive ? (
            <span className="active-badge">ACTIVE</span>
          ) : (
            <span className="upcoming-badge">UPCOMING</span>
          )}
        </div>

        <div className="notam-expand-icon">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Human-readable summary when collapsed */}
      {!isExpanded && humanSummary && (
        <div className="notam-human-summary">{humanSummary}</div>
      )}

      {/* Text preview when collapsed (fallback if no summary) */}
      {!isExpanded && !humanSummary && notam.text && (
        <div className="notam-preview">
          {notam.text.slice(0, 80)}
          {notam.text.length > 80 ? '...' : ''}
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div className="notam-content">
          {/* Human-readable summary at top when expanded */}
          {humanSummary && (
            <div className="notam-summary-expanded">
              <strong>{humanSummary}</strong>
            </div>
          )}

          {/* Decoded information */}
          {decoded && (
            <div className="notam-decoded">
              {decoded.affected_entity && (
                <div className="decoded-item">
                  <span className="decoded-label">Affected:</span>
                  <span>{decoded.affected_entity.display}</span>
                </div>
              )}
              {decoded.condition && (
                <div className="decoded-item">
                  <span className="decoded-label">Status:</span>
                  <span>{decoded.condition.label}</span>
                </div>
              )}
              {decoded.reason && (
                <div className="decoded-item">
                  <span className="decoded-label">Reason:</span>
                  <span>{decoded.reason.label}</span>
                </div>
              )}
              {decoded.category_label && decoded.category !== 'OTHER' && (
                <div className="decoded-item">
                  <span className="decoded-label">Category:</span>
                  <span>{decoded.category_label}</span>
                </div>
              )}
            </div>
          )}

          {/* Time validity */}
          <div className="notam-validity">
            <div className="validity-row">
              <Clock size={12} />
              <span className="validity-label">Effective:</span>
              <span className="validity-time">{formatDate(notam.effective_start)}</span>
            </div>
            {!isPermanent && notam.effective_end && (
              <div className="validity-row">
                <Clock size={12} />
                <span className="validity-label">Expires:</span>
                <span className="validity-time">{formatDate(notam.effective_end)}</span>
                {expiringSoon && <span className="expiring-badge">Soon</span>}
              </div>
            )}
            {isPermanent && (
              <div className="validity-row permanent">
                <AlertTriangle size={12} />
                <span>Permanent NOTAM</span>
              </div>
            )}
          </div>

          {/* Altitude restrictions */}
          {(notam.floor_ft != null || notam.ceiling_ft != null) && (
            <div className="notam-altitude">
              <span className="altitude-label">Altitude:</span>
              {notam.floor_ft != null && <span>{notam.floor_ft} ft</span>}
              {notam.floor_ft != null && notam.ceiling_ft != null && <span>-</span>}
              {notam.ceiling_ft != null && <span>{notam.ceiling_ft} ft</span>}
            </div>
          )}

          {/* Radius */}
          {notam.radius_nm && (
            <div className="notam-radius">
              <span className="radius-label">Radius:</span>
              <span>{notam.radius_nm} NM</span>
            </div>
          )}

          {/* Coordinates */}
          {hasLocation && (
            <div className="notam-coords">
              <MapPin size={12} />
              <span>
                {notam.latitude.toFixed(4)}, {notam.longitude.toFixed(4)}
              </span>
            </div>
          )}

          {/* Expanded text (abbreviations decoded) */}
          {decoded?.expanded_text && (
            <div className="notam-expanded-text">
              <div className="expanded-text-label">Plain English:</div>
              <div className="expanded-text-content">{decoded.expanded_text}</div>
            </div>
          )}

          {/* Full text (original) */}
          {notam.text && <div className="notam-full-text">{notam.text}</div>}

          {/* Keywords */}
          {notam.keywords && notam.keywords.length > 0 && (
            <div className="notam-keywords">
              {notam.keywords.map((kw, i) => (
                <span key={i} className="keyword-tag">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="notam-actions">
            {hasLocation && (
              <button
                className="notam-action-btn show-on-map"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowOnMap?.(notam);
                }}
                title="Show on map"
              >
                <Eye size={14} />
                <span>Show on Map</span>
              </button>
            )}

            <button
              className={`notam-action-btn acknowledge ${isAcknowledged ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge?.(notam.notam_id || notam.id);
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

export default NotamItem;
