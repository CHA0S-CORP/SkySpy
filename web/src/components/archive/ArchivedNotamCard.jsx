import React from 'react';
import { Archive, MapPin, ChevronDown, ChevronUp, Clock, Calendar, AlertTriangle } from 'lucide-react';
import { NOTAM_TYPES } from './archiveConstants';
import { formatDate, formatRelativeTime } from './archiveUtils';

// Archived NOTAM Card
export function ArchivedNotamCard({ notam, expanded, onToggle }) {
  const typeInfo = NOTAM_TYPES[notam.notam_type] || NOTAM_TYPES.D;
  const TypeIcon = typeInfo.icon;

  return (
    <div
      className={`archive-card notam-card ${notam.notam_type?.toLowerCase()} ${expanded ? 'expanded' : ''}`}
      onClick={onToggle}
    >
      <div className="archive-card-header">
        <div className="archive-type-badge" style={{ backgroundColor: typeInfo.color }}>
          <TypeIcon size={14} />
          <span>{typeInfo.label}</span>
        </div>
        <div className="archive-location">
          <MapPin size={14} />
          <span>{notam.location || 'Unknown'}</span>
        </div>
        <div className="archive-id">{notam.notam_id}</div>
        <div className="archive-archived-badge">
          <Archive size={12} />
          <span>{formatRelativeTime(notam.archived_at)}</span>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      <div className="archive-card-summary">
        <p className="archive-text-preview">
          {notam.text?.slice(0, 150)}{notam.text?.length > 150 ? '...' : ''}
        </p>
      </div>

      <div className="archive-card-meta">
        <div className="archive-time">
          <Clock size={12} />
          <span>Effective: {formatDate(notam.effective_start)}</span>
        </div>
        {notam.effective_end && !notam.is_permanent && (
          <div className="archive-time expired">
            <Calendar size={12} />
            <span>Expired: {formatDate(notam.effective_end)}</span>
          </div>
        )}
        {notam.is_permanent && (
          <div className="archive-permanent">
            <AlertTriangle size={12} />
            <span>Permanent</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="archive-card-details">
          <div className="archive-full-text">
            <h4>Full Text</h4>
            <pre>{notam.text}</pre>
          </div>

          {(notam.floor_ft != null || notam.ceiling_ft != null) && (
            <div className="archive-altitude">
              <h4>Altitude Restrictions</h4>
              <div className="altitude-range">
                {notam.floor_ft != null && <span>Floor: {notam.floor_ft} ft</span>}
                {notam.ceiling_ft != null && <span>Ceiling: {notam.ceiling_ft} ft</span>}
              </div>
            </div>
          )}

          {notam.radius_nm && (
            <div className="archive-radius">
              <h4>Radius</h4>
              <span>{notam.radius_nm} NM</span>
            </div>
          )}

          {(notam.latitude && notam.longitude) && (
            <div className="archive-coords">
              <h4>Coordinates</h4>
              <span>{notam.latitude.toFixed(4)}, {notam.longitude.toFixed(4)}</span>
            </div>
          )}

          <div className="archive-info">
            <h4>Archive Info</h4>
            <div className="archive-info-grid">
              <span>Archived: {formatDate(notam.archived_at)}</span>
              <span>Reason: {notam.archive_reason || 'expired'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArchivedNotamCard;
