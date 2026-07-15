import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

/**
 * Convective SIGMET popup component
 */
export function SigmetPopup({ sigmet, config, popupPosition, isDragging, onClose, onMouseDown }) {
  if (!sigmet) return null;

  return (
    <div
      className={`weather-popup sigmet-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      role="dialog"
      aria-label={`SIGMET ${sigmet.id || ''}`}
    >
      {/* Drag handle */}
      <div className="popup-drag-handle" onMouseDown={onMouseDown} aria-hidden="true" />
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <AlertTriangle size={20} />
        <span className="popup-callsign">SIGMET</span>
        <span
          className={`sigmet-severity-badge severity-${sigmet.severity?.level || 1}`}
          style={{
            backgroundColor: sigmet.severity?.color || 'rgba(255, 200, 0, 0.5)',
            border: `1px solid ${sigmet.severity?.stroke || 'rgba(255, 200, 0, 0.8)'}`,
          }}
        >
          {sigmet.severity?.label || 'Convective'}
        </span>
      </div>

      <div className="popup-details">
        <div className="detail-row">
          <span>ID</span>
          <span className="mono">{sigmet.id || '---'}</span>
        </div>

        <div className="detail-row">
          <span>Type</span>
          <span>{sigmet.type || sigmet.hazard || 'Convective'}</span>
        </div>

        {sigmet.qualifier && (
          <div className="detail-row">
            <span>Qualifier</span>
            <span>{sigmet.qualifier}</span>
          </div>
        )}

        <div className="detail-row">
          <span>Valid Time</span>
          <span>{sigmet.validTimeDisplay || '---'}</span>
        </div>

        {sigmet.altitude && (
          <div className="detail-row">
            <span>Altitude</span>
            <span>
              FL{Math.round((sigmet.altitude.lower || 0) / 100)} - FL
              {Math.round((sigmet.altitude.upper || 45000) / 100)}
            </span>
          </div>
        )}

        {sigmet.movement && (
          <div className="detail-row">
            <span>Movement</span>
            <span>{sigmet.movement}</span>
          </div>
        )}

        {sigmet.intensity && (
          <div className="detail-row">
            <span>Trend</span>
            <span>{sigmet.intensity}</span>
          </div>
        )}

        {sigmet.rawText && (
          <div className="detail-row raw-section">
            <span>Raw Text</span>
            <span className="mono raw-text" style={{ fontSize: '10px', maxWidth: '250px' }}>
              {sigmet.rawText}
            </span>
          </div>
        )}

        {sigmet.source && (
          <div className="detail-row">
            <span>Source</span>
            <span>{sigmet.source}</span>
          </div>
        )}
      </div>
    </div>
  );
}
