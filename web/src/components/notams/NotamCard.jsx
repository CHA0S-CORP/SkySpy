import React from 'react';
import { MapPin, Clock, Calendar, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { NOTAM_TYPES } from './notamTypes';
import { formatDate } from './notamUtils';

// Single NOTAM Card component
export function NotamCard({ notam, expanded, onToggle }) {
  const typeInfo = NOTAM_TYPES[notam.type] || NOTAM_TYPES.D;
  const TypeIcon = typeInfo.icon;
  const isActive = new Date(notam.effective_start) <= new Date();
  const isPermanent = notam.is_permanent;

  return (
    <div
      className={`notam-card ${notam.type?.toLowerCase()} ${expanded ? 'expanded' : ''} ${isActive ? 'active' : 'upcoming'}`}
      onClick={onToggle}
    >
      <div className="notam-card-header">
        <div className="notam-type-badge" style={{ backgroundColor: typeInfo.color }}>
          <TypeIcon size={14} />
          <span>{typeInfo.label}</span>
        </div>
        <div className="notam-location">
          <MapPin size={14} />
          <span>{notam.location || 'Unknown'}</span>
        </div>
        <div className="notam-id">{notam.notam_id}</div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      <div className="notam-card-summary">
        <p className="notam-text-preview">
          {notam.text?.slice(0, 150)}{notam.text?.length > 150 ? '...' : ''}
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

          {(notam.latitude && notam.longitude) && (
            <div className="notam-coords">
              <h4>Coordinates</h4>
              <span>{notam.latitude.toFixed(4)}, {notam.longitude.toFixed(4)}</span>
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
                  <span key={i} className="keyword-tag">{kw}</span>
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
