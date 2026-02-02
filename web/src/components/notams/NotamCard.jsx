import React from 'react';
import {
  MapPin,
  Clock,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Info,
} from 'lucide-react';
import { NOTAM_TYPES } from './notamTypes';
import { formatDate } from './notamUtils';

// Severity badge colors
const SEVERITY_COLORS = {
  critical: { bg: '#dc2626', text: '#fff' },
  moderate: { bg: '#f59e0b', text: '#000' },
  advisory: { bg: '#3b82f6', text: '#fff' },
};

// Single NOTAM Card component
export function NotamCard({ notam, expanded, onToggle }) {
  const typeInfo = NOTAM_TYPES[notam.type] || NOTAM_TYPES.D;
  const TypeIcon = typeInfo.icon;
  const isActive = new Date(notam.effective_start) <= new Date();
  const isPermanent = notam.is_permanent;

  // Get decoded data from backend if available
  const decoded = notam.decoded;
  const severity = notam.severity || decoded?.severity || 'advisory';
  const humanSummary = notam.human_summary || decoded?.human_summary;
  const severityColors = SEVERITY_COLORS[severity] || SEVERITY_COLORS.advisory;

  return (
    <div
      className={`notam-card ${notam.type?.toLowerCase()} ${expanded ? 'expanded' : ''} ${isActive ? 'active' : 'upcoming'} severity-${severity}`}
      onClick={onToggle}
    >
      <div className="notam-card-header">
        <div className="notam-type-badge" style={{ backgroundColor: typeInfo.color }}>
          <TypeIcon size={14} />
          <span>{typeInfo.label}</span>
        </div>
        {/* Severity badge */}
        <div
          className="notam-severity-badge"
          style={{ backgroundColor: severityColors.bg, color: severityColors.text }}
        >
          {severity === 'critical' && <AlertTriangle size={12} />}
          {severity === 'moderate' && <AlertCircle size={12} />}
          {severity === 'advisory' && <Info size={12} />}
          <span>{severity}</span>
        </div>
        <div className="notam-location">
          <MapPin size={14} />
          <span>{notam.location || 'Unknown'}</span>
        </div>
        <div className="notam-id">{notam.notam_id}</div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {/* Human-readable summary if available */}
      {humanSummary && (
        <div className="notam-human-summary">
          <p>{humanSummary}</p>
        </div>
      )}

      <div className="notam-card-summary">
        <p className="notam-text-preview">
          {notam.text?.slice(0, 150)}
          {notam.text?.length > 150 ? '...' : ''}
        </p>
      </div>

      <div className="notam-card-meta">
        <div className="notam-time">
          <Clock size={12} />
          <span>
            {isActive ? 'Active' : 'Starts'}: {formatDate(notam.effective_start)}
          </span>
        </div>
        {!isPermanent && notam.effective_end && (
          <div className="notam-time expires">
            <Calendar size={12} />
            <span>Expires: {formatDate(notam.effective_end)}</span>
          </div>
        )}
        {isPermanent && (
          <div className="notam-permanent">
            <AlertTriangle size={12} />
            <span>Permanent</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="notam-card-details">
          {/* Decoded information section */}
          {decoded && (
            <div className="notam-decoded-info">
              {decoded.affected_entity && (
                <div className="decoded-row">
                  <span className="decoded-label">Affected:</span>
                  <span className="decoded-value">{decoded.affected_entity.display}</span>
                </div>
              )}
              {decoded.condition && (
                <div className="decoded-row">
                  <span className="decoded-label">Status:</span>
                  <span className="decoded-value">{decoded.condition.label}</span>
                </div>
              )}
              {decoded.reason && (
                <div className="decoded-row">
                  <span className="decoded-label">Reason:</span>
                  <span className="decoded-value">{decoded.reason.label}</span>
                </div>
              )}
              {decoded.category_label && (
                <div className="decoded-row">
                  <span className="decoded-label">Category:</span>
                  <span className="decoded-value">{decoded.category_label}</span>
                </div>
              )}
            </div>
          )}

          {/* Expanded text with abbreviations decoded */}
          {decoded?.expanded_text && (
            <div className="notam-expanded-text">
              <h4>Plain English</h4>
              <p>{decoded.expanded_text}</p>
            </div>
          )}

          <div className="notam-full-text">
            <h4>Full Text</h4>
            <pre>{notam.text}</pre>
          </div>

          {(notam.floor_ft != null || notam.ceiling_ft != null) && (
            <div className="notam-altitude">
              <h4>Altitude Restrictions</h4>
              <div className="altitude-range">
                {notam.floor_ft != null && <span>Floor: {notam.floor_ft} ft</span>}
                {notam.ceiling_ft != null && <span>Ceiling: {notam.ceiling_ft} ft</span>}
              </div>
            </div>
          )}

          {notam.radius_nm && (
            <div className="notam-radius">
              <h4>Radius</h4>
              <span>{notam.radius_nm} NM</span>
            </div>
          )}

          {notam.latitude && notam.longitude && (
            <div className="notam-coords">
              <h4>Coordinates</h4>
              <span>
                {notam.latitude.toFixed(4)}, {notam.longitude.toFixed(4)}
              </span>
            </div>
          )}

          {notam.reason && (
            <div className="notam-reason">
              <h4>Reason</h4>
              <span>{notam.reason}</span>
            </div>
          )}

          {notam.keywords && notam.keywords.length > 0 && (
            <div className="notam-keywords">
              <h4>Keywords</h4>
              <div className="keyword-tags">
                {notam.keywords.map((kw, i) => (
                  <span key={i} className="keyword-tag">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotamCard;
