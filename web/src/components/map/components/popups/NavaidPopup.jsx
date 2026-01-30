import React from 'react';
import { X, Radio } from 'lucide-react';

/**
 * Navaid popup component
 */
export function NavaidPopup({
  navaid,
  config,
  popupPosition,
  isDragging,
  onClose,
  onMouseDown,
  getDistanceNm,
  getBearing,
}) {
  if (!navaid) return null;

  return (
    <div
      className={`weather-popup navaid-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onMouseDown={onMouseDown}
    >
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Radio size={20} />
        <span className="popup-callsign">{navaid.id}</span>
        <span className="navaid-type-badge">{navaid.type || 'NAV'}</span>
      </div>

      <div className="popup-details">
        <div className="detail-row">
          <span>Type</span>
          <span>{navaid.type || 'Unknown'}</span>
        </div>

        {navaid.name && (
          <div className="detail-row">
            <span>Name</span>
            <span>{navaid.name}</span>
          </div>
        )}

        {navaid.freq && (
          <div className="detail-row">
            <span>Frequency</span>
            <span>{navaid.freq} MHz</span>
          </div>
        )}

        {navaid.channel && (
          <div className="detail-row">
            <span>Channel</span>
            <span>{navaid.channel}</span>
          </div>
        )}

        <div className="detail-row">
          <span>Position</span>
          <span>{navaid.lat?.toFixed(4)}°, {navaid.lon?.toFixed(4)}°</span>
        </div>

        {navaid.elev && (
          <div className="detail-row">
            <span>Elevation</span>
            <span>{navaid.elev.toLocaleString()} ft</span>
          </div>
        )}

        <div className="detail-row">
          <span>Distance</span>
          <span>{getDistanceNm(navaid.lat, navaid.lon).toFixed(1)} nm</span>
        </div>

        <div className="detail-row">
          <span>Bearing</span>
          <span>{Math.round(getBearing(navaid.lat, navaid.lon))}°</span>
        </div>
      </div>
    </div>
  );
}
