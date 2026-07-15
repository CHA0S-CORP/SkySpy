import React from 'react';
import { X, Layers } from 'lucide-react';

/**
 * Airspace popup component
 */
export function AirspacePopup({
  airspace,
  config,
  popupPosition,
  isDragging,
  onClose,
  onMouseDown,
}) {
  if (!airspace) return null;

  return (
    <div
      className={`weather-popup airspace-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      role="dialog"
      aria-label={`Airspace information for ${airspace.name || 'Airspace'}`}
    >
      {/* Drag handle */}
      <div className="popup-drag-handle" onMouseDown={onMouseDown} aria-hidden="true" />
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Layers size={20} />
        <span className="popup-callsign">{airspace.name || 'Airspace'}</span>
        <span
          className={`airport-class-badge class-${(airspace.class || airspace.airspace_class || '').toLowerCase()}`}
        >
          {airspace.class ||
            airspace.airspace_class ||
            airspace.type ||
            'Airspace'}
        </span>
      </div>

      <div className="popup-details">
        {airspace.name && (
          <div className="detail-row">
            <span>Name</span>
            <span>{airspace.name}</span>
          </div>
        )}

        <div className="detail-row">
          <span>Class/Type</span>
          <span>
            {airspace.class ||
              airspace.airspace_class ||
              airspace.type ||
              'Unknown'}
          </span>
        </div>

        {(airspace.floor_ft !== undefined ||
          airspace.lower_alt_ft !== undefined) && (
          <div className="detail-row">
            <span>Floor</span>
            <span>
              {(airspace.floor_ft ?? airspace.lower_alt_ft)?.toLocaleString() ||
                'SFC'}{' '}
              ft
            </span>
          </div>
        )}

        {(airspace.ceiling_ft !== undefined ||
          airspace.upper_alt_ft !== undefined) && (
          <div className="detail-row">
            <span>Ceiling</span>
            <span>
              {(
                airspace.ceiling_ft ?? airspace.upper_alt_ft
              )?.toLocaleString() || 'UNL'}{' '}
              ft
            </span>
          </div>
        )}

        {airspace.controlling_agency && (
          <div className="detail-row">
            <span>Agency</span>
            <span>{airspace.controlling_agency}</span>
          </div>
        )}

        {airspace.schedule && (
          <div className="detail-row">
            <span>Schedule</span>
            <span>{airspace.schedule}</span>
          </div>
        )}

        {(airspace.center_lat || airspace.lat) && (
          <div className="detail-row">
            <span>Center</span>
            <span>
              {(airspace.center_lat || airspace.lat)?.toFixed(4)}°,{' '}
              {(airspace.center_lon || airspace.lon)?.toFixed(4)}°
            </span>
          </div>
        )}

        {airspace.source && (
          <div className="detail-row">
            <span>Source</span>
            <span>{airspace.source}</span>
          </div>
        )}
      </div>
    </div>
  );
}
