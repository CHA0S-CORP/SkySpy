import React from 'react';
import { X, Wind } from 'lucide-react';

/**
 * G-AIRMET / AIRMET area popup. Works for any AIRMET hazard (turbulence, icing,
 * freezing level, IFR, mountain obscuration, LLWS, surface wind). Mirrors the
 * SigmetPopup shell so it slots into the same drag/close plumbing.
 */
export function AirmetPopup({ airmet, config, popupPosition, isDragging, onClose, onMouseDown }) {
  if (!airmet) return null;

  const fl = (ft) => (ft === null || ft === undefined ? null : `FL${Math.round(ft / 100)}`);
  const lower = fl(airmet.lowerAltFt);
  const upper = fl(airmet.upperAltFt);
  const meta = airmet.meta || {};

  return (
    <div
      className={`weather-popup airmet-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      role="dialog"
      aria-label={`AIRMET ${airmet.id || ''}`}
    >
      <div className="popup-drag-handle" onMouseDown={onMouseDown} aria-hidden="true" />
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Wind size={20} style={{ color: meta.color }} />
        <span className="popup-callsign">AIRMET</span>
        <span
          className="airmet-hazard-badge"
          style={{
            backgroundColor: `${meta.color}22`,
            border: `1px solid ${meta.color}`,
            color: meta.color,
          }}
        >
          {meta.label || airmet.hazard}
        </span>
      </div>

      <div className="popup-details">
        <div className="detail-row">
          <span>Advisory</span>
          <span className="mono">{airmet.id || '---'}</span>
        </div>
        <div className="detail-row">
          <span>Hazard</span>
          <span className="mono">{airmet.hazard || '—'}</span>
        </div>
        {airmet.severity && (
          <div className="detail-row">
            <span>Severity</span>
            <span>{airmet.severity}</span>
          </div>
        )}
        <div className="detail-row">
          <span>Geometry</span>
          <span>{airmet.closed ? 'Area' : 'Line'}</span>
        </div>
        {(lower || upper) && (
          <div className="detail-row">
            <span>Altitude</span>
            <span>
              {lower || 'SFC'} - {upper || '---'}
            </span>
          </div>
        )}
        {airmet.validTo && (
          <div className="detail-row">
            <span>Valid Until</span>
            <span>{new Date(airmet.validTo).toLocaleString()}</span>
          </div>
        )}
        {airmet.rawText && (
          <div className="detail-row raw-section">
            <span>Raw Text</span>
            <span className="mono raw-text" style={{ fontSize: '10px', maxWidth: '250px' }}>
              {airmet.rawText}
            </span>
          </div>
        )}
        <div className="detail-row">
          <span>Source</span>
          <span>NWS G-AIRMET</span>
        </div>
      </div>
    </div>
  );
}

export default AirmetPopup;
